using Microsoft.EntityFrameworkCore;

namespace AccessoryViewer.Api.Data;

/// <summary>
/// Schema 由 db/migrations 的 SQL 管理（Supabase CLI 或手動套用），
/// 這裡不使用 EF Core Migrations，只描述對應關係。
/// </summary>
public class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    public DbSet<Make> Makes => Set<Make>();
    public DbSet<VehicleModel> VehicleModels => Set<VehicleModel>();
    public DbSet<Generation> Generations => Set<Generation>();
    public DbSet<Trim> Trims => Set<Trim>();
    public DbSet<TrimSpec> TrimSpecs => Set<TrimSpec>();
    public DbSet<TireSpec> TireSpecs => Set<TireSpec>();
    public DbSet<PaintColor> PaintColors => Set<PaintColor>();
    public DbSet<ModelAsset> ModelAssets => Set<ModelAsset>();
    public DbSet<Part> Parts => Set<Part>();
    public DbSet<PartSuggestion> PartSuggestions => Set<PartSuggestion>();
    public DbSet<AssetPartMapping> AssetPartMappings => Set<AssetPartMapping>();
    public DbSet<AssetOpening> AssetOpenings => Set<AssetOpening>();
    public DbSet<Build> Builds => Set<Build>();
    public DbSet<BuildAccessory> BuildAccessories => Set<BuildAccessory>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.HasDefaultSchema("viewer");

        b.Entity<Make>().ToTable("makes");
        b.Entity<VehicleModel>(e =>
        {
            e.ToTable("vehicle_models");
            e.HasOne(x => x.Make).WithMany(x => x.Models).HasForeignKey(x => x.MakeId);
        });
        b.Entity<Generation>(e =>
        {
            e.ToTable("generations");
            e.HasOne(x => x.Model).WithMany(x => x.Generations).HasForeignKey(x => x.ModelId);
        });
        b.Entity<Trim>(e =>
        {
            e.ToTable("trims");
            e.HasOne(x => x.Generation).WithMany(x => x.Trims).HasForeignKey(x => x.GenerationId);
            e.HasOne(x => x.Spec).WithOne().HasForeignKey<TrimSpec>(x => x.TrimId);
            e.HasMany(x => x.Tires).WithOne().HasForeignKey(x => x.TrimId);
        });
        b.Entity<TrimSpec>(e =>
        {
            e.ToTable("trim_specs");
            e.HasKey(x => x.TrimId);
            e.Property(x => x.TrimId).ValueGeneratedNever();
            e.Property(x => x.Sources).HasColumnType("jsonb");
        });
        b.Entity<TireSpec>(e =>
        {
            e.ToTable("tire_specs");
            e.HasKey(x => new { x.TrimId, x.Axle });
        });
        b.Entity<PaintColor>(e =>
        {
            e.ToTable("paint_colors");
            e.HasOne<Generation>().WithMany(x => x.PaintColors).HasForeignKey(x => x.GenerationId);
        });
        b.Entity<ModelAsset>(e =>
        {
            e.ToTable("model_assets");
            e.Property(x => x.Params).HasColumnType("jsonb");
            e.HasMany(x => x.PartMappings).WithOne().HasForeignKey(x => x.AssetId);
            e.HasMany(x => x.Openings).WithOne().HasForeignKey(x => x.AssetId);
        });
        b.Entity<Part>().ToTable("parts");
        b.Entity<PartSuggestion>().ToTable("part_suggestions");
        b.Entity<AssetPartMapping>(e =>
        {
            e.ToTable("asset_part_mappings");
            e.Property(x => x.Zone).HasColumnType("jsonb");
            e.HasOne(x => x.Part).WithMany().HasForeignKey(x => x.PartId);
        });
        b.Entity<AssetOpening>(e =>
        {
            e.ToTable("asset_openings");
            e.Property(x => x.Hinge).HasColumnType("jsonb");
            e.Property(x => x.BodyRegion).HasColumnType("jsonb");
            e.Property(x => x.GlassRegion).HasColumnType("jsonb");
        });
        b.Entity<Build>(e =>
        {
            e.ToTable("builds");
            e.Property(x => x.Id).HasDefaultValueSql("gen_random_uuid()");
            e.Property(x => x.CreatedAt).HasDefaultValueSql("now()");
            e.Property(x => x.UpdatedAt).HasDefaultValueSql("now()").ValueGeneratedOnAddOrUpdate();
            e.HasOne(x => x.Trim).WithMany().HasForeignKey(x => x.TrimId);
            e.HasMany(x => x.Accessories).WithOne().HasForeignKey(x => x.BuildId);
        });
        b.Entity<BuildAccessory>(e =>
        {
            e.ToTable("build_accessories");
            e.Property(x => x.Id).HasDefaultValueSql("gen_random_uuid()");
            e.Property(x => x.CreatedAt).HasDefaultValueSql("now()");
            e.Property(x => x.UpdatedAt).HasDefaultValueSql("now()").ValueGeneratedOnAddOrUpdate();
            e.Property(x => x.Position).HasColumnType("jsonb");
            e.HasOne(x => x.Part).WithMany().HasForeignKey(x => x.PartId);
        });
    }
}
