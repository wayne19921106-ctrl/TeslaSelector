using AccessoryViewer.Api.Contracts;
using AccessoryViewer.Api.Data;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace AccessoryViewer.Api.Controllers;

/// <summary>
/// 配置清單與配件標註。
/// 第一階段沒有登入：持有 build ID（UUID）即可讀寫。接 Supabase Auth 後，
/// 在這裡驗證 JWT 並比對 owner_id。
/// </summary>
[ApiController]
[Route("api/v1/builds")]
public class BuildsController(AppDbContext db) : ControllerBase
{
    private const string DefaultName = "我的 Model Y";

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

        return CreatedAtAction(nameof(Get), new { buildId = build.Id }, build.ToDto());
    }

    [HttpGet("{buildId:guid}")]
    public async Task<ActionResult<BuildDto>> Get(Guid buildId, CancellationToken ct)
    {
        var build = await db.Builds.AsNoTracking()
            .Include(b => b.Accessories).ThenInclude(a => a.Part)
            .Include(b => b.Accessories).ThenInclude(a => a.AccessoryType).ThenInclude(t => t!.Category)
            .Include(b => b.Accessories).ThenInclude(a => a.Product)
            .AsSplitQuery()
            .FirstOrDefaultAsync(b => b.Id == buildId, ct);
        return build is null ? BuildNotFound() : build.ToDto();
    }

    [HttpPatch("{buildId:guid}")]
    public async Task<ActionResult<BuildDto>> Update(Guid buildId, UpdateBuildRequest req, CancellationToken ct)
    {
        var build = await db.Builds
            .Include(b => b.Trim)
            .Include(b => b.Accessories).ThenInclude(a => a.Part)
            .Include(b => b.Accessories).ThenInclude(a => a.AccessoryType).ThenInclude(t => t!.Category)
            .Include(b => b.Accessories).ThenInclude(a => a.Product)
            .AsSplitQuery()
            .FirstOrDefaultAsync(b => b.Id == buildId, ct);
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
        return build.ToDto();
    }

    [HttpDelete("{buildId:guid}")]
    public async Task<IActionResult> Delete(Guid buildId, CancellationToken ct)
    {
        var deleted = await db.Builds.Where(b => b.Id == buildId).ExecuteDeleteAsync(ct);
        return deleted == 0 ? BuildNotFound() : NoContent();
    }

    // ---- 配件 ------------------------------------------------------------------

    [HttpPost("{buildId:guid}/accessories")]
    public async Task<ActionResult<AccessoryDto>> AddAccessory(Guid buildId, CreateAccessoryRequest req, CancellationToken ct)
    {
        if (!await db.Builds.AnyAsync(b => b.Id == buildId, ct)) return BuildNotFound();

        var part = await db.Parts.FirstOrDefaultAsync(p => p.Code == req.PartCode, ct);
        if (part is null) return Invalid(nameof(req.PartCode), "找不到這個部位。");

        var status = req.Status ?? "considering";
        if (!AccessoryStatus.All.Contains(status))
            return Invalid(nameof(req.Status), "status 必須是 considering、planned、purchased 或 installed。");

        if (req.AssetId is int assetId && !await db.ModelAssets.AnyAsync(a => a.Id == assetId && a.IsActive, ct))
            return Invalid(nameof(req.AssetId), "找不到這個模型資源。");

        var (type, product, error) = await ResolveCatalog(part.Id, req.AccessoryTypeId, req.ProductId, ct);
        if (error is not null) return error;

        var name = !string.IsNullOrWhiteSpace(req.Name) ? req.Name.Trim()
                 : product?.DisplayName ?? type?.Name;
        if (string.IsNullOrWhiteSpace(name))
            return Invalid(nameof(req.Name), "請選擇配件，或輸入自訂的配件名稱。");

        var acc = new BuildAccessory
        {
            BuildId = buildId,
            PartId = part.Id,
            Part = part,
            AssetId = req.AssetId,
            AccessoryTypeId = type?.Id,
            AccessoryType = type,
            ProductId = product?.Id,
            Product = product,
            Name = name.Length > 40 ? name[..40] : name,
            Status = status,
            PriceTwd = req.PriceTwd,
            Note = string.IsNullOrWhiteSpace(req.Note) ? null : req.Note.Trim(),
            Position = req.Position?.ToJson(),
            IsExample = req.IsExample,
        };
        db.BuildAccessories.Add(acc);
        await TouchBuild(buildId, ct);
        await db.SaveChangesAsync(ct);

        return CreatedAtAction(nameof(Get), new { buildId }, acc.ToDto());
    }

    [HttpPatch("{buildId:guid}/accessories/{accessoryId:guid}")]
    public async Task<ActionResult<AccessoryDto>> UpdateAccessory(
        Guid buildId, Guid accessoryId, UpdateAccessoryRequest req, CancellationToken ct)
    {
        var acc = await db.BuildAccessories
            .Include(a => a.Part)
            .Include(a => a.AccessoryType).ThenInclude(t => t!.Category)
            .Include(a => a.Product)
            .FirstOrDefaultAsync(a => a.Id == accessoryId && a.BuildId == buildId, ct);
        if (acc is null) return Problem(statusCode: StatusCodes.Status404NotFound, title: "找不到這個配件。");

        if (req.PartCode is not null && req.PartCode != acc.Part.Code)
        {
            var part = await db.Parts.FirstOrDefaultAsync(p => p.Code == req.PartCode, ct);
            if (part is null) return Invalid(nameof(req.PartCode), "找不到這個部位。");
            acc.PartId = part.Id;
            acc.Part = part;
        }
        var clear = req.Clear ?? [];
        if (req.AccessoryTypeId is not null || req.ProductId is not null || req.PartCode is not null
            || clear.Contains("accessoryType") || clear.Contains("product"))
        {
            var typeId = clear.Contains("accessoryType") ? null : req.AccessoryTypeId ?? acc.AccessoryTypeId;
            var productId = clear.Contains("product") || clear.Contains("accessoryType") ? null
                          : req.ProductId ?? (req.AccessoryTypeId is null ? acc.ProductId : null);
            var (type, product, error) = await ResolveCatalog(acc.PartId, typeId, productId, ct);
            if (error is not null) return error;
            acc.AccessoryTypeId = type?.Id; acc.AccessoryType = type;
            acc.ProductId = product?.Id; acc.Product = product;
            if (req.Name is null && (req.AccessoryTypeId is not null || req.ProductId is not null))
                acc.Name = product?.DisplayName ?? type?.Name ?? acc.Name;
        }
        if (req.Name is not null) acc.Name = req.Name.Trim();
        if (req.Status is not null)
        {
            if (!AccessoryStatus.All.Contains(req.Status))
                return Invalid(nameof(req.Status), "status 必須是 considering、planned、purchased 或 installed。");
            acc.Status = req.Status;
        }
        if (req.PriceTwd is not null) acc.PriceTwd = req.PriceTwd;
        if (req.Note is not null) acc.Note = req.Note.Trim();
        if (req.Position is not null) acc.Position = req.Position.ToJson();
        if (req.AssetId is not null) acc.AssetId = req.AssetId;

        foreach (var field in clear)
        {
            switch (field)
            {
                case "accessoryType": case "product": break;   // 上面已處理
                case "priceTwd": acc.PriceTwd = null; break;
                case "note": acc.Note = null; break;
                case "position": acc.Position = null; break;
                default: return Invalid(nameof(req.Clear), $"無法清除欄位「{field}」，只能清除 accessoryType、product、priceTwd、note、position。");
            }
        }

        await TouchBuild(buildId, ct);
        await db.SaveChangesAsync(ct);
        return acc.ToDto();
    }

    [HttpDelete("{buildId:guid}/accessories/{accessoryId:guid}")]
    public async Task<IActionResult> DeleteAccessory(Guid buildId, Guid accessoryId, CancellationToken ct)
    {
        var deleted = await db.BuildAccessories
            .Where(a => a.Id == accessoryId && a.BuildId == buildId)
            .ExecuteDeleteAsync(ct);
        if (deleted == 0) return Problem(statusCode: StatusCodes.Status404NotFound, title: "找不到這個配件。");
        await db.Builds.Where(b => b.Id == buildId)
            .ExecuteUpdateAsync(s => s.SetProperty(b => b.UpdatedAt, DateTime.UtcNow), ct);
        return NoContent();
    }

    // ---- helpers ---------------------------------------------------------------

    /// <summary>
    /// 檢查配件是否為這個車項可裝的配件、產品是否為「車項 × 配件」的適用產品。
    /// 指定產品時必須同時指定配件。
    /// </summary>
    private async Task<(AccessoryType? Type, Product? Product, ActionResult? Error)> ResolveCatalog(
        int partId, int? accessoryTypeId, int? productId, CancellationToken ct)
    {
        if (productId is not null && accessoryTypeId is null)
            return (null, null, Invalid("productId", "選擇產品時也要指定配件。"));
        if (accessoryTypeId is null) return (null, null, null);

        var link = await db.PartAccessoryTypes
            .Include(pa => pa.AccessoryType).ThenInclude(t => t.Category)
            .FirstOrDefaultAsync(pa => pa.PartId == partId && pa.AccessoryTypeId == accessoryTypeId
                                       && pa.AccessoryType.IsActive, ct);
        if (link is null)
            return (null, null, Invalid("accessoryTypeId", "這個車項沒有這項配件。"));
        if (productId is null) return (link.AccessoryType, null, null);

        var product = await db.PartAccessoryProducts
            .Where(pp => pp.PartAccessoryTypeId == link.Id && pp.ProductId == productId && pp.Product.IsActive)
            .Select(pp => pp.Product)
            .FirstOrDefaultAsync(ct);
        return product is null
            ? (null, null, Invalid("productId", "這個產品不適用於所選的車項與配件。"))
            : (link.AccessoryType, product, null);
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

    private ActionResult Invalid(string field, string message)
    {
        ModelState.AddModelError(char.ToLowerInvariant(field[0]) + field[1..], message);
        return ValidationProblem(ModelState);
    }
}
