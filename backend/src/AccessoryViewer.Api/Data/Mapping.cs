using System.Text.Json;
using AccessoryViewer.Api.Contracts;

namespace AccessoryViewer.Api.Data;

/// <summary>Entity → DTO 轉換，以及 jsonb 欄位的讀寫。</summary>
public static class Mapping
{
    // jsonb 內容一律為 snake_case（與 SQL seed 一致）
    private static readonly JsonSerializerOptions Snake = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
        PropertyNameCaseInsensitive = true,
    };

    private sealed record SourceJson(string[]? Fields, string? Title, string? Url, string? RetrievedAt, bool? Verified, string? Note);
    private sealed record ZoneJson(string? Surface, double[]? Min, double[]? Max);
    private sealed record PositionJson(double[] P, double[] N);

    public static TrimSummaryDto ToSummary(this Trim t) =>
        new(t.Id, t.Code, t.Name, t.ModelYear, t.Market, t.Drivetrain, t.StyleVariant);

    public static TrimSpecDto ToDto(this TrimSpec s)
    {
        var sources = (s.Sources.Deserialize<SourceJson[]>(Snake) ?? [])
            .Select(x => new SpecSourceDto(x.Fields ?? [], x.Title ?? "", x.Url, x.RetrievedAt, x.Verified ?? false, x.Note))
            .ToList();
        return new TrimSpecDto(
            s.LengthMm, s.WidthMm, s.WidthMirrorsFoldedMm, s.WidthMirrorsUnfoldedMm,
            s.HeightMm, s.WheelbaseMm, s.FrontTrackMm, s.RearTrackMm, s.GroundClearanceMm,
            s.CurbWeightKg, s.VerifiedAt is not null, s.VerifiedAt, sources);
    }

    /// <summary>輪胎外徑 = 輪圈直徑 × 25.4 + 2 × 胎寬 × 扁平比。</summary>
    public static int OverallDiameterMm(short widthMm, short aspectRatio, short rimDiameterIn) =>
        (int)Math.Round(rimDiameterIn * 25.4 + 2.0 * widthMm * aspectRatio / 100.0, MidpointRounding.AwayFromZero);

    public static TireDto ToDto(this TireSpec t) => new(
        t.Axle, $"{t.WidthMm}/{t.AspectRatio} R{t.RimDiameterIn}", t.WidthMm, t.AspectRatio, t.RimDiameterIn,
        t.RimWidthIn, t.RimOffsetMm, OverallDiameterMm(t.WidthMm, t.AspectRatio, t.RimDiameterIn));

    public static PaintColorDto ToDto(this PaintColor c) =>
        new(c.Id, c.Code, c.Name, c.Hex, c.Metalness, c.Roughness);

    public static AssetSummaryDto ToSummary(this ModelAsset a) =>
        new(a.Id, a.Code, a.Name, a.AssetType, a.Tier, a.Version);

    public static PartMappingDto ToDto(this AssetPartMapping m)
    {
        ZoneDto? zone = null;
        if (m.Zone is not null)
        {
            var z = m.Zone.Deserialize<ZoneJson>(Snake)!;
            zone = new ZoneDto(z.Surface ?? "body", z.Min ?? [], z.Max ?? []);
        }
        return new PartMappingDto(m.Part.Code, m.MappingType, m.Priority, zone, m.MeshKey);
    }

    public static OpeningDto ToDto(this AssetOpening o) => new(
        o.Code, o.Name, o.Hinge.Deserialize<double[]>() ?? [], o.Axis, o.OpenAngleDeg,
        ToRegion(o.BodyRegion), ToRegion(o.GlassRegion), o.MeshKeys);

    private static RegionDto? ToRegion(JsonDocument? doc)
    {
        if (doc is null) return null;
        var z = doc.Deserialize<ZoneJson>(Snake)!;
        return new RegionDto(z.Min ?? [], z.Max ?? []);
    }

    public static AccessoryCategoryDto? ToDto(this AccessoryCategory? c) =>
        c is null ? null : new AccessoryCategoryDto(c.Code, c.Name);

    public static BrandDto ToDto(this Brand b) =>
        new(b.Id, b.Code, b.Name, b.LogoUrl, b.PromoCode, b.Description, b.Url);

    public static ProductDto ToDto(this Product p) => new(
        p.Id, p.Source,
        p.Brand is null ? null : new BrandRefDto(p.Brand.Id, p.Brand.Code, p.Brand.Name, p.Brand.LogoUrl),
        p.BrandLabel, p.Name, p.Model, p.SuggestedPriceTwd, p.Rating, p.Url, p.DisplayName);

    public static AccessoryDto ToDto(this BuildAccessory a) => new(
        a.Id, a.Part.Code, a.Part.Name, a.AssetId,
        new AccessoryTypeRefDto(a.AccessoryType.Id, a.AccessoryType.Name,
            a.AccessoryType.Source == CatalogSource.Custom, a.AccessoryType.Category.ToDto()),
        a.Status, a.Note, a.Position is null ? null : ToPositionDto(a.Position), a.IsExample,
        a.Products.OrderBy(x => x.CreatedAt).ThenBy(x => x.Id)
            .Select(x => new CandidateDto(x.Id, x.IsSelected, x.Product.ToDto())).ToList(),
        a.CreatedAt, a.UpdatedAt);

    public static BuildDto ToDto(this Build b) => new(
        b.Id, b.Name, b.TrimId, b.PaintColorId, b.CreatedAt, b.UpdatedAt,
        b.Accessories.OrderBy(x => x.CreatedAt).Select(x => x.ToDto()).ToList());

    private static PositionDto ToPositionDto(JsonDocument doc)
    {
        var p = doc.Deserialize<PositionJson>(Snake)!;
        return new PositionDto { P = p.P, N = p.N };
    }

    public static JsonDocument ToJson(this PositionDto p) =>
        JsonSerializer.SerializeToDocument(new PositionJson(
            p.P.Select(v => Math.Round(v, 5)).ToArray(),
            p.N.Select(v => Math.Round(v, 5)).ToArray()), Snake);
}
