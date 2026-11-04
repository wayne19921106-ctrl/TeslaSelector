using System.ComponentModel.DataAnnotations;

namespace AccessoryViewer.Api.Contracts;

public static class AccessoryStatus
{
    public static readonly string[] All = ["considering", "planned", "purchased", "installed"];
}

public sealed record BuildDto(
    Guid Id, string Name, int TrimId, int? PaintColorId,
    DateTime CreatedAt, DateTime UpdatedAt, IReadOnlyList<AccessoryDto> Accessories);

public sealed record AccessoryDto(
    Guid Id, string PartCode, string PartName, int? AssetId, string Name, string Status,
    int? PriceTwd, string? Note, PositionDto? Position, bool IsExample,
    DateTime CreatedAt, DateTime UpdatedAt);

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

public sealed class CreateAccessoryRequest
{
    [Required, StringLength(40)] public string PartCode { get; init; } = "";
    [Required, StringLength(40, MinimumLength = 1)] public string Name { get; init; } = "";
    public int? AssetId { get; init; }
    public string? Status { get; init; }
    [Range(0, int.MaxValue)] public int? PriceTwd { get; init; }
    [StringLength(500)] public string? Note { get; init; }
    public PositionDto? Position { get; init; }
    public bool IsExample { get; init; }
}

public sealed class UpdateAccessoryRequest
{
    [StringLength(40)] public string? PartCode { get; init; }
    [StringLength(40, MinimumLength = 1)] public string? Name { get; init; }
    public string? Status { get; init; }
    [Range(0, int.MaxValue)] public int? PriceTwd { get; init; }
    [StringLength(500)] public string? Note { get; init; }
    public PositionDto? Position { get; init; }
    public int? AssetId { get; init; }

    /// <summary>要清除的欄位：priceTwd、note、position。</summary>
    public string[]? Clear { get; init; }
}
