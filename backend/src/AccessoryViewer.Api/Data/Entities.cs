using System.Text.Json;

namespace AccessoryViewer.Api.Data;

// 對應 db/migrations 中 viewer schema 的資料表。欄位名稱由 snake_case 命名慣例自動轉換。

public class Make
{
    public short Id { get; set; }
    public string Code { get; set; } = "";
    public string Name { get; set; } = "";
    public DateTime CreatedAt { get; set; }
    public List<VehicleModel> Models { get; set; } = [];
}

public class VehicleModel
{
    public int Id { get; set; }
    public short MakeId { get; set; }
    public Make Make { get; set; } = null!;
    public string Code { get; set; } = "";
    public string Name { get; set; } = "";
    public string BodyType { get; set; } = "";
    public int SortOrder { get; set; }
    public DateTime CreatedAt { get; set; }
    public List<Generation> Generations { get; set; } = [];
}

public class Generation
{
    public int Id { get; set; }
    public int ModelId { get; set; }
    public VehicleModel Model { get; set; } = null!;
    public string Code { get; set; } = "";
    public string Name { get; set; } = "";
    public short StartYear { get; set; }
    public short? EndYear { get; set; }
    public int SortOrder { get; set; }
    public DateTime CreatedAt { get; set; }
    public List<Trim> Trims { get; set; } = [];
    public List<PaintColor> PaintColors { get; set; } = [];
}

public class Trim
{
    public int Id { get; set; }
    public int GenerationId { get; set; }
    public Generation Generation { get; set; } = null!;
    public short ModelYear { get; set; }
    public string Market { get; set; } = "TW";
    public string Code { get; set; } = "";
    public string Name { get; set; } = "";
    public string Drivetrain { get; set; } = "";
    /// <summary>外觀版本：standard / premium / performance，對應模型參數 variants 的 key。</summary>
    public string StyleVariant { get; set; } = "premium";
    public int SortOrder { get; set; }
    public bool IsActive { get; set; }
    public DateTime CreatedAt { get; set; }
    public TrimSpec? Spec { get; set; }
    public List<TireSpec> Tires { get; set; } = [];
}

public class TrimSpec
{
    public int TrimId { get; set; }
    public int LengthMm { get; set; }
    public int WidthMm { get; set; }
    public int? WidthMirrorsFoldedMm { get; set; }
    public int? WidthMirrorsUnfoldedMm { get; set; }
    public int HeightMm { get; set; }
    public int WheelbaseMm { get; set; }
    public int FrontTrackMm { get; set; }
    public int RearTrackMm { get; set; }
    public int GroundClearanceMm { get; set; }
    public int? CurbWeightKg { get; set; }
    public JsonDocument Sources { get; set; } = null!;
    public DateTime? VerifiedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}

public class TireSpec
{
    public int TrimId { get; set; }
    public string Axle { get; set; } = "";
    public short WidthMm { get; set; }
    public short AspectRatio { get; set; }
    public short RimDiameterIn { get; set; }
    public decimal? RimWidthIn { get; set; }
    public short? RimOffsetMm { get; set; }
}

public class PaintColor
{
    public int Id { get; set; }
    public int GenerationId { get; set; }
    public string Code { get; set; } = "";
    public string Name { get; set; } = "";
    public string Hex { get; set; } = "";
    public decimal Metalness { get; set; }
    public decimal Roughness { get; set; }
    public int SortOrder { get; set; }
    public bool IsActive { get; set; }
}

public class ModelAsset
{
    public int Id { get; set; }
    public int GenerationId { get; set; }
    public int? TrimId { get; set; }
    public string Code { get; set; } = "";
    public string Name { get; set; } = "";
    public string AssetType { get; set; } = "";
    public string Tier { get; set; } = "free";
    public int Version { get; set; }
    public string? Generator { get; set; }
    public JsonDocument Params { get; set; } = null!;
    public string? StorageBucket { get; set; }
    public string? StoragePath { get; set; }
    public long? FileSizeBytes { get; set; }
    public bool IsActive { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
    public List<AssetPartMapping> PartMappings { get; set; } = [];
    public List<AssetOpening> Openings { get; set; } = [];
}

/// <summary>車項，例如前擋玻璃、前左車門。</summary>
public class Part
{
    public int Id { get; set; }
    public string Code { get; set; } = "";
    public string Name { get; set; } = "";
    /// <summary>介面分組，例如外觀鈑件、車內。</summary>
    public string Category { get; set; } = "";
    public int SortOrder { get; set; }
    public List<PartAccessoryType> AccessoryTypes { get; set; } = [];
}

/// <summary>配件分類：外觀、內裝、安全、操控。</summary>
public class AccessoryCategory
{
    public short Id { get; set; }
    public string Code { get; set; } = "";
    public string Name { get; set; } = "";
    public int SortOrder { get; set; }
}

/// <summary>配件，例如隔熱紙、玻璃鍍膜。</summary>
public class AccessoryType
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public short? CategoryId { get; set; }
    public AccessoryCategory? Category { get; set; }
    public int SortOrder { get; set; }
    public bool IsActive { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}

/// <summary>車項可裝的配件（車項 × 配件）。</summary>
public class PartAccessoryType
{
    public int Id { get; set; }
    public int PartId { get; set; }
    public int AccessoryTypeId { get; set; }
    public AccessoryType AccessoryType { get; set; } = null!;
    public int SortOrder { get; set; }
    public List<PartAccessoryProduct> Products { get; set; } = [];
}

/// <summary>產品，例如舒熱佳 LX。</summary>
public class Product
{
    public int Id { get; set; }
    public string Brand { get; set; } = "";
    public string Name { get; set; } = "";
    public string? Description { get; set; }
    public int? PriceTwd { get; set; }
    public string? Url { get; set; }
    public int SortOrder { get; set; }
    public bool IsActive { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }

    public string DisplayName => $"{Brand} {Name}";
}

/// <summary>某車項的某配件可選的產品。</summary>
public class PartAccessoryProduct
{
    public int PartAccessoryTypeId { get; set; }
    public int ProductId { get; set; }
    public Product Product { get; set; } = null!;
    public int SortOrder { get; set; }
}

public class AssetPartMapping
{
    public int Id { get; set; }
    public int AssetId { get; set; }
    public int PartId { get; set; }
    public Part Part { get; set; } = null!;
    public string MappingType { get; set; } = "";
    public JsonDocument? Zone { get; set; }
    public string? MeshKey { get; set; }
    public int Priority { get; set; }
}

public class AssetOpening
{
    public int Id { get; set; }
    public int AssetId { get; set; }
    public string Code { get; set; } = "";
    public string Name { get; set; } = "";
    public JsonDocument Hinge { get; set; } = null!;
    public string Axis { get; set; } = "";
    public decimal OpenAngleDeg { get; set; }
    public JsonDocument? BodyRegion { get; set; }
    public JsonDocument? GlassRegion { get; set; }
    public string[] MeshKeys { get; set; } = [];
    public int SortOrder { get; set; }
}

public class Build
{
    public Guid Id { get; set; }
    public Guid? OwnerId { get; set; }
    public string Name { get; set; } = "";
    public int TrimId { get; set; }
    public Trim Trim { get; set; } = null!;
    public int? PaintColorId { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
    public List<BuildAccessory> Accessories { get; set; } = [];
}

public class BuildAccessory
{
    public Guid Id { get; set; }
    public Guid BuildId { get; set; }
    public int PartId { get; set; }
    public Part Part { get; set; } = null!;
    public int? AssetId { get; set; }
    public int? AccessoryTypeId { get; set; }
    public AccessoryType? AccessoryType { get; set; }
    public int? ProductId { get; set; }
    public Product? Product { get; set; }
    /// <summary>顯示名稱：自訂名稱，或由產品／配件名稱帶入。</summary>
    public string Name { get; set; } = "";
    public string Status { get; set; } = "considering";
    public int? PriceTwd { get; set; }
    public string? Note { get; set; }
    public JsonDocument? Position { get; set; }
    public bool IsExample { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}
