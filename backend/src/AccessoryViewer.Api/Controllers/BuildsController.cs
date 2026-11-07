using AccessoryViewer.Api.Contracts;
using AccessoryViewer.Api.Data;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace AccessoryViewer.Api.Controllers;

/// <summary>
/// 配置清單：車項 → 配件（內建或自訂）→ 候選產品（內建或自訂，最多選定一筆）。
/// 第一階段沒有登入：持有 build ID（UUID）即可讀寫。接 Supabase Auth 後，
/// 在這裡驗證 JWT 並比對 owner_id。
/// </summary>
[ApiController]
[Route("api/v1/builds")]
public class BuildsController(AppDbContext db) : ControllerBase
{
    private const string DefaultName = "我的 Model Y";

    // ---- 配置清單 --------------------------------------------------------------

    [HttpPost]
    public async Task<ActionResult<BuildDto>> Create(CreateBuildRequest req, CancellationToken ct)
    {
        var trim = await ActiveTrim(req.TrimId!.Value, ct);
        if (trim is null) return Invalid(nameof(req.TrimId), "找不到這個版本。");
        if (req.PaintColorId is int colorId && !await ColorFits(colorId, trim.GenerationId, ct))
            return Invalid(nameof(req.PaintColorId), "這個車漆不適用於所選版本。");

        var build = new Build
        {
            Name = string.IsNullOrWhiteSpace(req.Name) ? DefaultName : req.Name.Trim(),
            TrimId = trim.Id,
            PaintColorId = req.PaintColorId,
        };
        db.Builds.Add(build);
        await db.SaveChangesAsync(ct);

        return CreatedAtAction(nameof(Get), new { buildId = build.Id }, (await LoadBuild(build.Id, ct))!.ToDto());
    }

    [HttpGet("{buildId:guid}")]
    public async Task<ActionResult<BuildDto>> Get(Guid buildId, CancellationToken ct)
    {
        var build = await LoadBuild(buildId, ct);
        return build is null ? BuildNotFound() : build.ToDto();
    }

    [HttpPatch("{buildId:guid}")]
    public async Task<ActionResult<BuildDto>> Update(Guid buildId, UpdateBuildRequest req, CancellationToken ct)
    {
        var build = await db.Builds.Include(b => b.Trim).FirstOrDefaultAsync(b => b.Id == buildId, ct);
        if (build is null) return BuildNotFound();

        if (req.Name is not null) build.Name = req.Name.Trim();

        var generationId = build.Trim.GenerationId;
        if (req.TrimId is int trimId && trimId != build.TrimId)
        {
            var trim = await ActiveTrim(trimId, ct);
            if (trim is null) return Invalid(nameof(req.TrimId), "找不到這個版本。");
            build.TrimId = trim.Id;
            generationId = trim.GenerationId;
        }

        var colorId = req.PaintColorId ?? build.PaintColorId;
        if (colorId is int cid && !await ColorFits(cid, generationId, ct))
            return Invalid(nameof(req.PaintColorId), "這個車漆不適用於所選版本。");
        build.PaintColorId = colorId;

        await db.SaveChangesAsync(ct);
        return (await LoadBuild(buildId, ct))!.ToDto();
    }

    [HttpDelete("{buildId:guid}")]
    public async Task<IActionResult> Delete(Guid buildId, CancellationToken ct)
    {
        var deleted = await db.Builds.Where(b => b.Id == buildId).ExecuteDeleteAsync(ct);
        return deleted == 0 ? BuildNotFound() : NoContent();
    }

    // ---- 配件 ------------------------------------------------------------------

    /// <summary>在車項下加入配件（內建配件或自訂配件）。同一車項同一配件只能加一次。</summary>
    [HttpPost("{buildId:guid}/accessories")]
    public async Task<ActionResult<AccessoryDto>> AddAccessory(Guid buildId, CreateAccessoryRequest req, CancellationToken ct)
    {
        if (!await db.Builds.AnyAsync(b => b.Id == buildId, ct)) return BuildNotFound();

        var part = await db.Parts.FirstOrDefaultAsync(p => p.Code == req.PartCode, ct);
        if (part is null) return Invalid(nameof(req.PartCode), "找不到這個車項。");

        if (req.AssetId is int assetId && !await db.ModelAssets.AnyAsync(a => a.Id == assetId && a.IsActive, ct))
            return Invalid(nameof(req.AssetId), "找不到這個模型資源。");

        int typeId;
        if (req.AccessoryTypeId is int builtinId)
        {
            var linked = await db.PartAccessoryTypes.AnyAsync(pa => pa.PartId == part.Id && pa.AccessoryTypeId == builtinId
                && pa.AccessoryType.IsActive && pa.AccessoryType.Source == CatalogSource.Builtin, ct);
            if (!linked) return Invalid(nameof(req.AccessoryTypeId), "這個車項沒有這項配件。");
            typeId = builtinId;
        }
        else
        {
            // 自訂配件：同一份配置清單內同名的自訂配件共用一筆
            var name = req.CustomAccessoryName!.Trim();
            var custom = await db.AccessoryTypes.FirstOrDefaultAsync(t =>
                t.Source == CatalogSource.Custom && t.OwnerBuildId == buildId && t.Name == name, ct);
            if (custom is null)
            {
                custom = new AccessoryType { Name = name, Source = CatalogSource.Custom, OwnerBuildId = buildId, IsActive = true };
                db.AccessoryTypes.Add(custom);
                await db.SaveChangesAsync(ct);
            }
            typeId = custom.Id;
        }

        if (await db.BuildAccessories.AnyAsync(a => a.BuildId == buildId && a.PartId == part.Id && a.AccessoryTypeId == typeId, ct))
            return Problem(statusCode: StatusCodes.Status409Conflict, title: "這個車項已經加過這項配件。");

        var acc = new BuildAccessory
        {
            BuildId = buildId,
            PartId = part.Id,
            AccessoryTypeId = typeId,
            AssetId = req.AssetId,
            Note = string.IsNullOrWhiteSpace(req.Note) ? null : req.Note.Trim(),
            Position = req.Position?.ToJson(),
            IsExample = req.IsExample,
        };
        db.BuildAccessories.Add(acc);
        await db.SaveChangesAsync(ct);
        await TouchBuild(buildId, ct);

        return CreatedAtAction(nameof(Get), new { buildId }, (await LoadAccessory(buildId, acc.Id, ct))!.ToDto());
    }

    /// <summary>修改狀態、備註、位置。狀態只能在有選定產品時設定。</summary>
    [HttpPatch("{buildId:guid}/accessories/{accessoryId:guid}")]
    public async Task<ActionResult<AccessoryDto>> UpdateAccessory(
        Guid buildId, Guid accessoryId, UpdateAccessoryRequest req, CancellationToken ct)
    {
        var acc = await db.BuildAccessories.FirstOrDefaultAsync(a => a.Id == accessoryId && a.BuildId == buildId, ct);
        if (acc is null) return AccessoryNotFound();

        if (req.Status is not null)
        {
            if (!AccessoryStatus.All.Contains(req.Status))
                return Invalid(nameof(req.Status), "status 必須是 purchased（已購買）或 installed（已安裝）。");
            if (!await db.BuildAccessoryProducts.AnyAsync(x => x.BuildAccessoryId == acc.Id && x.IsSelected, ct))
                return Invalid(nameof(req.Status), "請先選定產品，再設定已購買或已安裝。");
            acc.Status = req.Status;
        }
        if (req.Note is not null) acc.Note = req.Note.Trim();
        if (req.Position is not null) acc.Position = req.Position.ToJson();
        if (req.AssetId is not null) acc.AssetId = req.AssetId;

        foreach (var field in req.Clear ?? [])
        {
            switch (field)
            {
                case "status": acc.Status = null; break;
                case "note": acc.Note = null; break;
                case "position": acc.Position = null; break;
                default: return Invalid(nameof(req.Clear), $"無法清除欄位「{field}」，只能清除 status、note、position。");
            }
        }

        await db.SaveChangesAsync(ct);
        await TouchBuild(buildId, ct);
        return (await LoadAccessory(buildId, acc.Id, ct))!.ToDto();
    }

    /// <summary>刪除配件（連同候選產品；不再使用的自訂產品與自訂配件一併清除）。</summary>
    [HttpDelete("{buildId:guid}/accessories/{accessoryId:guid}")]
    public async Task<IActionResult> DeleteAccessory(Guid buildId, Guid accessoryId, CancellationToken ct)
    {
        var deleted = await db.BuildAccessories
            .Where(a => a.Id == accessoryId && a.BuildId == buildId)
            .ExecuteDeleteAsync(ct);
        if (deleted == 0) return AccessoryNotFound();
        await CleanupCustom(buildId, ct);
        await TouchBuild(buildId, ct);
        return NoContent();
    }

    // ---- 候選產品 ----------------------------------------------------------------

    /// <summary>在配件下加入候選產品（內建產品或自訂產品）。</summary>
    [HttpPost("{buildId:guid}/accessories/{accessoryId:guid}/products")]
    public async Task<ActionResult<AccessoryDto>> AddCandidate(
        Guid buildId, Guid accessoryId, AddCandidateRequest req, CancellationToken ct)
    {
        var acc = await db.BuildAccessories.FirstOrDefaultAsync(a => a.Id == accessoryId && a.BuildId == buildId, ct);
        if (acc is null) return AccessoryNotFound();

        int productId;
        if (req.ProductId is int builtinId)
        {
            // 內建產品必須是這個「車項 × 配件」的適用產品
            var ok = await db.PartAccessoryProducts.AnyAsync(pp =>
                pp.ProductId == builtinId && pp.Product.IsActive && pp.Product.Source == CatalogSource.Builtin
                && db.PartAccessoryTypes.Any(pa => pa.Id == pp.PartAccessoryTypeId
                                                   && pa.PartId == acc.PartId && pa.AccessoryTypeId == acc.AccessoryTypeId), ct);
            if (!ok) return Invalid(nameof(req.ProductId), "這個產品不適用於這個車項的這項配件。");
            productId = builtinId;
        }
        else
        {
            var c = req.Custom!;
            if (c.BrandId is int brandId && !await db.Brands.AnyAsync(b => b.Id == brandId && b.IsActive, ct))
                return Invalid("custom.brandId", "找不到這個品牌。");
            var product = new Product
            {
                AccessoryTypeId = acc.AccessoryTypeId,
                BrandId = c.BrandId,
                BrandName = string.IsNullOrWhiteSpace(c.BrandName) ? null : c.BrandName.Trim(),
                Name = c.Name.Trim(),
                Model = string.IsNullOrWhiteSpace(c.Model) ? null : c.Model.Trim(),
                SuggestedPriceTwd = c.SuggestedPriceTwd,
                Rating = c.Rating,
                Url = string.IsNullOrWhiteSpace(c.Url) ? null : c.Url.Trim(),
                Source = CatalogSource.Custom,
                OwnerBuildId = buildId,
            };
            db.Products.Add(product);
            await db.SaveChangesAsync(ct);
            productId = product.Id;
        }

        if (await db.BuildAccessoryProducts.AnyAsync(x => x.BuildAccessoryId == acc.Id && x.ProductId == productId, ct))
            return Problem(statusCode: StatusCodes.Status409Conflict, title: "這個產品已經在候選清單中。");

        var candidate = new BuildAccessoryProduct { BuildAccessoryId = acc.Id, ProductId = productId };
        db.BuildAccessoryProducts.Add(candidate);
        await db.SaveChangesAsync(ct);
        if (req.Select) await SetSelected(acc.Id, candidate.Id, ct);
        await TouchBuild(buildId, ct);

        return (await LoadAccessory(buildId, acc.Id, ct))!.ToDto();
    }

    /// <summary>選定或取消選定候選產品。選定時同配件的其他候選自動取消；取消時狀態清空。</summary>
    [HttpPatch("{buildId:guid}/accessories/{accessoryId:guid}/products/{candidateId:guid}")]
    public async Task<ActionResult<AccessoryDto>> UpdateCandidate(
        Guid buildId, Guid accessoryId, Guid candidateId, UpdateCandidateRequest req, CancellationToken ct)
    {
        var exists = await db.BuildAccessoryProducts.AnyAsync(x => x.Id == candidateId && x.BuildAccessoryId == accessoryId
            && db.BuildAccessories.Any(a => a.Id == accessoryId && a.BuildId == buildId), ct);
        if (!exists) return CandidateNotFound();

        if (req.IsSelected == true) await SetSelected(accessoryId, candidateId, ct);
        else
            // 狀態由資料庫 trigger 在沒有選定產品時自動清空
            await db.BuildAccessoryProducts.Where(x => x.Id == candidateId)
                .ExecuteUpdateAsync(s => s.SetProperty(x => x.IsSelected, false), ct);

        await TouchBuild(buildId, ct);
        return (await LoadAccessory(buildId, accessoryId, ct))!.ToDto();
    }

    /// <summary>移除候選產品；自訂產品一併刪除。</summary>
    [HttpDelete("{buildId:guid}/accessories/{accessoryId:guid}/products/{candidateId:guid}")]
    public async Task<ActionResult<AccessoryDto>> DeleteCandidate(
        Guid buildId, Guid accessoryId, Guid candidateId, CancellationToken ct)
    {
        var deleted = await db.BuildAccessoryProducts
            .Where(x => x.Id == candidateId && x.BuildAccessoryId == accessoryId
                        && db.BuildAccessories.Any(a => a.Id == accessoryId && a.BuildId == buildId))
            .ExecuteDeleteAsync(ct);
        if (deleted == 0) return CandidateNotFound();
        await CleanupCustom(buildId, ct);
        await TouchBuild(buildId, ct);
        return (await LoadAccessory(buildId, accessoryId, ct))!.ToDto();
    }

    // ---- helpers ---------------------------------------------------------------

    private IQueryable<BuildAccessory> AccessoriesWithDetails() => db.BuildAccessories.AsNoTracking()
        .Include(a => a.Part)
        .Include(a => a.AccessoryType).ThenInclude(t => t.Category)
        .Include(a => a.Products).ThenInclude(x => x.Product).ThenInclude(p => p.Brand)
        .AsSplitQuery();

    private Task<BuildAccessory?> LoadAccessory(Guid buildId, Guid accessoryId, CancellationToken ct) =>
        AccessoriesWithDetails().FirstOrDefaultAsync(a => a.Id == accessoryId && a.BuildId == buildId, ct);

    private async Task<Build?> LoadBuild(Guid buildId, CancellationToken ct)
    {
        var build = await db.Builds.AsNoTracking().FirstOrDefaultAsync(b => b.Id == buildId, ct);
        if (build is null) return null;
        build.Accessories = await AccessoriesWithDetails()
            .Where(a => a.BuildId == buildId)
            .OrderBy(a => a.CreatedAt).ThenBy(a => a.Id)
            .ToListAsync(ct);
        return build;
    }

    /// <summary>
    /// 選定一筆候選：先取消同配件的其他選定，再選定這筆。分兩步並包在交易中，
    /// 因為「同配件最多一筆選定」的唯一索引不允許兩筆同時為 true。換選定產品時狀態會清空。
    /// </summary>
    private async Task SetSelected(Guid accessoryId, Guid candidateId, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        await db.BuildAccessoryProducts
            .Where(x => x.BuildAccessoryId == accessoryId && x.IsSelected && x.Id != candidateId)
            .ExecuteUpdateAsync(s => s.SetProperty(x => x.IsSelected, false), ct);
        await db.BuildAccessoryProducts
            .Where(x => x.Id == candidateId)
            .ExecuteUpdateAsync(s => s.SetProperty(x => x.IsSelected, true), ct);
        await tx.CommitAsync(ct);
    }

    /// <summary>刪除這份配置清單中已不再使用的自訂產品與自訂配件。</summary>
    private async Task CleanupCustom(Guid buildId, CancellationToken ct)
    {
        await db.Products
            .Where(p => p.Source == CatalogSource.Custom && p.OwnerBuildId == buildId
                        && !db.BuildAccessoryProducts.Any(x => x.ProductId == p.Id))
            .ExecuteDeleteAsync(ct);
        await db.AccessoryTypes
            .Where(t => t.Source == CatalogSource.Custom && t.OwnerBuildId == buildId
                        && !db.BuildAccessories.Any(a => a.AccessoryTypeId == t.Id))
            .ExecuteDeleteAsync(ct);
    }

    private Task<Trim?> ActiveTrim(int trimId, CancellationToken ct) =>
        db.Trims.AsNoTracking().FirstOrDefaultAsync(t => t.Id == trimId && t.IsActive, ct);

    private Task<bool> ColorFits(int colorId, int generationId, CancellationToken ct) =>
        db.PaintColors.AnyAsync(c => c.Id == colorId && c.GenerationId == generationId && c.IsActive, ct);

    /// <summary>更新配置清單的 updated_at（由 trigger 寫入 now()）。</summary>
    private async Task TouchBuild(Guid buildId, CancellationToken ct) =>
        await db.Builds.Where(b => b.Id == buildId)
            .ExecuteUpdateAsync(s => s.SetProperty(b => b.UpdatedAt, DateTime.UtcNow), ct);

    private ActionResult BuildNotFound() =>
        Problem(statusCode: StatusCodes.Status404NotFound, title: "找不到這個配置清單。");

    private ActionResult AccessoryNotFound() =>
        Problem(statusCode: StatusCodes.Status404NotFound, title: "找不到這個配件。");

    private ActionResult CandidateNotFound() =>
        Problem(statusCode: StatusCodes.Status404NotFound, title: "找不到這個候選產品。");

    private ActionResult Invalid(string field, string message)
    {
        ModelState.AddModelError(char.ToLowerInvariant(field[0]) + field[1..], message);
        return ValidationProblem(ModelState);
    }
}
