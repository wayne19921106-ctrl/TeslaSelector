using AccessoryViewer.Api.Contracts;
using AccessoryViewer.Api.Data;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace AccessoryViewer.Api.Controllers;

[ApiController]
[Route("api/v1")]
public class CatalogController(AppDbContext db) : ControllerBase
{
    /// <summary>品牌 → 車系 → 世代 → 版本 目錄（只含啟用中的版本）。</summary>
    [HttpGet("catalog")]
    public async Task<ActionResult<CatalogDto>> GetCatalog([FromQuery] string market = "TW", CancellationToken ct = default)
    {
        var rows = await db.Trims.AsNoTracking()
            .Where(t => t.IsActive && t.Market == market)
            .Select(t => new
            {
                Trim = t,
                Gen = t.Generation,
                Model = t.Generation.Model,
                Make = t.Generation.Model.Make,
            })
            .ToListAsync(ct);

        var makes = rows
            .GroupBy(r => r.Make.Id)
            .Select(mk => new MakeDto(
                mk.First().Make.Code, mk.First().Make.Name,
                mk.GroupBy(r => r.Model.Id)
                  .OrderBy(g => g.First().Model.SortOrder)
                  .Select(md => new ModelDto(
                      md.First().Model.Code, md.First().Model.Name,
                      md.GroupBy(r => r.Gen.Id)
                        .OrderBy(g => g.First().Gen.SortOrder)
                        .Select(gn => new GenerationDto(
                            gn.Key, gn.First().Gen.Code, gn.First().Gen.Name,
                            gn.First().Gen.StartYear, gn.First().Gen.EndYear,
                            gn.OrderByDescending(r => r.Trim.ModelYear)
                              .ThenBy(r => r.Trim.SortOrder)
                              .Select(r => r.Trim.ToSummary())
                              .ToList()))
                        .ToList()))
                  .ToList()))
            .OrderBy(m => m.Name)
            .ToList();

        return new CatalogDto(makes);
    }

    /// <summary>版本完整規格、輪胎、可選車漆與可用模型資源。</summary>
    [HttpGet("trims/{trimId:int}")]
    public async Task<ActionResult<TrimDetailDto>> GetTrim(int trimId, CancellationToken ct)
    {
        var trim = await db.Trims.AsNoTracking()
            .Include(t => t.Spec)
            .Include(t => t.Tires)
            .Include(t => t.Generation).ThenInclude(g => g.Model).ThenInclude(m => m.Make)
            .AsSplitQuery()
            .FirstOrDefaultAsync(t => t.Id == trimId && t.IsActive, ct);

        if (trim is null || trim.Spec is null)
            return Problem(statusCode: StatusCodes.Status404NotFound, title: "找不到這個版本。");

        var colors = await db.PaintColors.AsNoTracking()
            .Where(c => c.GenerationId == trim.GenerationId && c.IsActive)
            .OrderBy(c => c.SortOrder)
            .ToListAsync(ct);

        var assets = await db.ModelAssets.AsNoTracking()
            .Where(a => a.IsActive && a.GenerationId == trim.GenerationId && (a.TrimId == null || a.TrimId == trim.Id))
            .OrderBy(a => a.Tier == "free" ? 0 : 1).ThenBy(a => a.Id)
            .ToListAsync(ct);

        var g = trim.Generation;
        return new TrimDetailDto(
            trim.Id, trim.Code, trim.Name, trim.ModelYear, trim.Market, trim.Drivetrain, trim.StyleVariant,
            new GenerationRefDto(g.Id, g.Code, g.Name, g.Model.Name, g.Model.Make.Name),
            trim.Spec.ToDto(),
            trim.Tires.OrderBy(x => x.Axle == "front" ? 0 : 1).Select(x => x.ToDto()).ToList(),
            colors.Select(c => c.ToDto()).ToList(),
            assets.Select(a => a.ToSummary()).ToList());
    }

    /// <summary>模型資源：產生器參數、部位對應、可開啟件。</summary>
    [HttpGet("assets/{assetId:int}")]
    public async Task<ActionResult<AssetDetailDto>> GetAsset(int assetId, CancellationToken ct)
    {
        var a = await db.ModelAssets.AsNoTracking()
            .Include(x => x.PartMappings).ThenInclude(m => m.Part)
            .Include(x => x.Openings)
            .AsSplitQuery()
            .FirstOrDefaultAsync(x => x.Id == assetId && x.IsActive, ct);

        if (a is null)
            return Problem(statusCode: StatusCodes.Status404NotFound, title: "找不到這個模型資源。");

        // 第一階段尚未開放付費：premium 資源只回中繼資料，不提供下載網址
        var locked = a.Tier == "premium";

        return new AssetDetailDto(
            a.Id, a.Code, a.Name, a.AssetType, a.Tier, a.Version, a.Generator,
            a.Params.RootElement.Clone(), locked, Download: null,
            a.PartMappings
                .OrderBy(m => m.MappingType == "zone" ? 0 : 1).ThenBy(m => m.Priority).ThenBy(m => m.Id)
                .Select(m => m.ToDto()).ToList(),
            a.Openings.OrderBy(o => o.SortOrder).Select(o => o.ToDto()).ToList());
    }

    /// <summary>車項目錄：每個車項可裝的配件，以及各配件的適用產品。</summary>
    [HttpGet("parts")]
    public async Task<ActionResult<IReadOnlyList<PartDto>>> GetParts(CancellationToken ct)
    {
        var parts = await db.Parts.AsNoTracking()
            .Include(p => p.AccessoryTypes).ThenInclude(pa => pa.AccessoryType).ThenInclude(t => t.Category)
            .Include(p => p.AccessoryTypes).ThenInclude(pa => pa.Products).ThenInclude(pp => pp.Product).ThenInclude(pr => pr.Brand)
            .AsSplitQuery()
            .OrderBy(p => p.SortOrder)
            .ToListAsync(ct);

        return parts.Select(p => new PartDto(
                p.Code, p.Name, p.Category,
                p.AccessoryTypes
                    .Where(pa => pa.AccessoryType.IsActive && pa.AccessoryType.Source == CatalogSource.Builtin)
                    .OrderBy(pa => pa.SortOrder).ThenBy(pa => pa.AccessoryType.SortOrder)
                    .Select(pa => new PartAccessoryDto(
                        pa.AccessoryType.Id, pa.AccessoryType.Name, pa.AccessoryType.Category.ToDto(),
                        pa.Products
                            .Where(pp => pp.Product.IsActive && pp.Product.Source == CatalogSource.Builtin)
                            .OrderBy(pp => pp.SortOrder).ThenBy(pp => pp.Product.SortOrder)
                            .Select(pp => pp.Product.ToDto())
                            .ToList()))
                    .ToList()))
            .ToList();
    }

    /// <summary>品牌清單（自訂產品可選既有品牌）。</summary>
    [HttpGet("brands")]
    public async Task<ActionResult<IReadOnlyList<BrandDto>>> GetBrands(CancellationToken ct) =>
        (await db.Brands.AsNoTracking()
            .Where(b => b.IsActive)
            .OrderBy(b => b.SortOrder).ThenBy(b => b.Code)
            .ToListAsync(ct))
        .Select(b => b.ToDto())
        .ToList();

    /// <summary>配件分類：外觀、內裝、安全、操控。</summary>
    [HttpGet("accessory-categories")]
    public async Task<ActionResult<IReadOnlyList<AccessoryCategoryDto>>> GetAccessoryCategories(CancellationToken ct) =>
        await db.AccessoryCategories.AsNoTracking()
            .OrderBy(c => c.SortOrder)
            .Select(c => new AccessoryCategoryDto(c.Code, c.Name))
            .ToListAsync(ct);
}
