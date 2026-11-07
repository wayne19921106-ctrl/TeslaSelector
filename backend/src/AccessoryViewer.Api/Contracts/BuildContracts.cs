using System.ComponentModel.DataAnnotations;

namespace AccessoryViewer.Api.Contracts;

public static class AccessoryStatus
{
    /// <summary>選定產品後可設定的狀態；null 表示尚未購買。</summary>
    public static readonly string[] All = ["purchased", "installed"];
}

public sealed record BuildDto(
    Guid Id, string Name, int TrimId, int? PaintColorId,
    DateTime CreatedAt, DateTime UpdatedAt, IReadOnlyList<AccessoryDto> Accessories);

/// <summary>配置清單中，某車項下的一個配件（內建或自訂）與其候選產品。</summary>
public sealed record AccessoryDto(
    Guid Id, string PartCode, string PartName, int? AssetId,
    AccessoryTypeRefDto AccessoryType,
    string? Status, string? Note, PositionDto? Position, bool IsExample,
    IReadOnlyList<CandidateDto> Products,
    DateTime CreatedAt, DateTime UpdatedAt);

public sealed record AccessoryTypeRefDto(int Id, string Name, bool IsCustom, AccessoryCategoryDto? Category);

/// <summary>候選產品；同一配件最多一筆 IsSelected。</summary>
public sealed record CandidateDto(Guid Id, bool IsSelected, ProductDto Product);

/// <summary>參考座標系中的點（p）與法向量（n）。</summary>
public sealed class PositionDto : IValidatableObject
{
    [Required] public double[] P { get; init; } = [];
    [Required] public double[] N { get; init; } = [];

    public IEnumerable<ValidationResult> Validate(ValidationContext context)
    {
        if (P.Length != 3 || P.Any(v => !double.IsFinite(v)))
            yield return new ValidationResult("position.p 必須是 3 個有限數值。", [nameof(P)]);
        if (N.Length != 3 || N.Any(v => !double.IsFinite(v)))
            yield return new ValidationResult("position.n 必須是 3 個有限數值。", [nameof(N)]);
    }
}

public sealed class CreateBuildRequest
{
    [StringLength(60, MinimumLength = 1)] public string? Name { get; init; }
    [Required] public int? TrimId { get; init; }
    public int? PaintColorId { get; init; }
}

public sealed class UpdateBuildRequest
{
    [StringLength(60, MinimumLength = 1)] public string? Name { get; init; }
    public int? TrimId { get; init; }
    public int? PaintColorId { get; init; }
}

/// <summary>在車項下加入配件：內建配件給 AccessoryTypeId，自訂配件給 CustomAccessoryName，二擇一。</summary>
public sealed class CreateAccessoryRequest : IValidatableObject
{
    [Required, StringLength(40)] public string PartCode { get; init; } = "";
    public int? AccessoryTypeId { get; init; }
    [StringLength(40, MinimumLength = 1)] public string? CustomAccessoryName { get; init; }
    public int? AssetId { get; init; }
    [StringLength(500)] public string? Note { get; init; }
    public PositionDto? Position { get; init; }
    public bool IsExample { get; init; }

    public IEnumerable<ValidationResult> Validate(ValidationContext context)
    {
        var hasType = AccessoryTypeId is not null;
        var hasCustom = !string.IsNullOrWhiteSpace(CustomAccessoryName);
        if (hasType == hasCustom)
            yield return new ValidationResult("請選擇一個配件，或輸入自訂配件名稱（二擇一）。",
                [nameof(AccessoryTypeId), nameof(CustomAccessoryName)]);
    }
}

public sealed class UpdateAccessoryRequest
{
    /// <summary>purchased／installed；需先選定產品。</summary>
    public string? Status { get; init; }
    [StringLength(500)] public string? Note { get; init; }
    public PositionDto? Position { get; init; }
    public int? AssetId { get; init; }

    /// <summary>要清除的欄位：status、note、position。</summary>
    public string[]? Clear { get; init; }
}

/// <summary>在配件下加入候選產品：內建產品給 ProductId，自訂產品給 Custom，二擇一。</summary>
public sealed class AddCandidateRequest : IValidatableObject
{
    public int? ProductId { get; init; }
    public CustomProductInput? Custom { get; init; }
    /// <summary>加入後直接選定。</summary>
    public bool Select { get; init; }

    public IEnumerable<ValidationResult> Validate(ValidationContext context)
    {
        if ((ProductId is null) == (Custom is null))
            yield return new ValidationResult("請選擇內建產品，或輸入自訂產品（二擇一）。", [nameof(ProductId), nameof(Custom)]);
    }
}

public sealed class CustomProductInput : IValidatableObject
{
    /// <summary>選既有品牌時填；否則可用 BrandName 直接輸入品牌文字。</summary>
    public int? BrandId { get; init; }
    [StringLength(60)] public string? BrandName { get; init; }
    [Required, StringLength(60, MinimumLength = 1)] public string Name { get; init; } = "";
    [StringLength(60)] public string? Model { get; init; }
    [Range(0, int.MaxValue)] public int? SuggestedPriceTwd { get; init; }
    [Range(1, 5)] public short? Rating { get; init; }
    [Url, StringLength(500)] public string? Url { get; init; }

    public IEnumerable<ValidationResult> Validate(ValidationContext context)
    {
        if (BrandId is not null && !string.IsNullOrWhiteSpace(BrandName))
            yield return new ValidationResult("品牌請擇一：選既有品牌或輸入品牌名稱。", [nameof(BrandId), nameof(BrandName)]);
    }
}

public sealed class UpdateCandidateRequest
{
    /// <summary>true 選定（同配件其他候選自動取消）；false 取消選定（狀態一併清空）。</summary>
    [Required] public bool? IsSelected { get; init; }
}
