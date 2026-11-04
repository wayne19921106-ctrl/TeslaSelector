using System.Text.Json;

namespace AccessoryViewer.Api.Contracts;

// ---- /catalog -----------------------------------------------------------------
public sealed record CatalogDto(IReadOnlyList<MakeDto> Makes);
public sealed record MakeDto(string Code, string Name, IReadOnlyList<ModelDto> Models);
public sealed record ModelDto(string Code, string Name, IReadOnlyList<GenerationDto> Generations);
public sealed record GenerationDto(int Id, string Code, string Name, short StartYear, short? EndYear, IReadOnlyList<TrimSummaryDto> Trims);
public sealed record TrimSummaryDto(int Id, string Code, string Name, short ModelYear, string Market, string Drivetrain);

// ---- /trims/{id} --------------------------------------------------------------
public sealed record TrimDetailDto(
    int Id, string Code, string Name, short ModelYear, string Market, string Drivetrain,
    GenerationRefDto Generation,
    TrimSpecDto Specs,
    IReadOnlyList<TireDto> Tires,
    IReadOnlyList<PaintColorDto> PaintColors,
    IReadOnlyList<AssetSummaryDto> Assets);

public sealed record GenerationRefDto(int Id, string Code, string Name, string ModelName, string MakeName);

public sealed record TrimSpecDto(
    int LengthMm, int WidthMm, int? WidthMirrorsFoldedMm, int? WidthMirrorsUnfoldedMm,
    int HeightMm, int WheelbaseMm, int FrontTrackMm, int RearTrackMm, int GroundClearanceMm,
    int? CurbWeightKg, bool Verified, DateTime? VerifiedAt, IReadOnlyList<SpecSourceDto> Sources);

public sealed record SpecSourceDto(
    IReadOnlyList<string> Fields, string Title, string? Url, string? RetrievedAt, bool Verified, string? Note);

public sealed record TireDto(
    string Axle, string Designation, short WidthMm, short AspectRatio, short RimDiameterIn,
    decimal? RimWidthIn, short? RimOffsetMm, int OverallDiameterMm);

public sealed record PaintColorDto(int Id, string Code, string Name, string Hex, decimal Metalness, decimal Roughness);

public sealed record AssetSummaryDto(int Id, string Code, string Name, string AssetType, string Tier, int Version);

// ---- /assets/{id} -------------------------------------------------------------
public sealed record AssetDetailDto(
    int Id, string Code, string Name, string AssetType, string Tier, int Version,
    string? Generator, JsonElement Params, bool Locked, AssetDownloadDto? Download,
    IReadOnlyList<PartMappingDto> PartMappings, IReadOnlyList<OpeningDto> Openings);

public sealed record AssetDownloadDto(string Url, DateTime ExpiresAt);

public sealed record PartMappingDto(string PartCode, string MappingType, int Priority, ZoneDto? Zone, string? MeshKey);
public sealed record ZoneDto(string Surface, double[] Min, double[] Max);
public sealed record RegionDto(double[] Min, double[] Max);

public sealed record OpeningDto(
    string Code, string Name, double[] Hinge, string Axis, decimal OpenAngleDeg,
    RegionDto? BodyRegion, RegionDto? GlassRegion, IReadOnlyList<string> MeshKeys);

// ---- /parts -------------------------------------------------------------------
public sealed record PartDto(string Code, string Name, string Category, string Kind, IReadOnlyList<string> Suggestions);
