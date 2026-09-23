import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import type { KitPublicationProposal } from "./panelClient.js";
import { variantDetail } from "./variantService.js";

const stableJson = (value: unknown): string => {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    typeof value === "number"
  )
    return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(",")}}`;
  }
  throw new Error("INVALID_PUBLICATION_CONTENT");
};

export function authoredKitContentHash(
  value:
    | Omit<KitPublicationProposal, "authoredContentHash">
    | KitPublicationProposal,
) {
  const {
    authoredContentHash: _ignored,
    publishedKitId: _relationship,
    ...content
  } = value as KitPublicationProposal;
  return createHash("sha256").update(stableJson(content)).digest("hex");
}

function complementaryBaseQuantity(line: any): number {
  const milli = Number(line.quantity_milli);
  const uom = String(
    line.base_uom_code_snapshot || line.current_base_uom_code || "",
  );
  if (!Number.isSafeInteger(milli) || milli <= 0)
    throw new Error("INVALID_COMPLEMENTARY_QUANTITY");
  if (["piece", "roll", "package", "box"].includes(uom)) {
    if (milli % 1000 !== 0)
      throw new Error("DISCRETE_QUANTITY_MUST_BE_INTEGER");
    return milli / 1000;
  }
  if (uom === "meter" || uom === "kg") return milli;
  if (uom === "square_meter") {
    const result = milli * 1000;
    if (!Number.isSafeInteger(result))
      throw new Error("INVALID_COMPLEMENTARY_QUANTITY");
    return result;
  }
  throw new Error("INVALID_COMPLEMENTARY_UOM");
}

export function buildKitPublicationProposal(
  db: Database.Database,
  variantId: string,
): { proposal?: KitPublicationProposal; missing: string[] } {
  const detail = variantDetail(db, variantId);
  if (!detail) return { missing: ["variant"] };
  const kit = db
    .prepare("SELECT * FROM kits WHERE id=?")
    .get(detail.kit_id) as any;
  const missing: string[] = [];
  if (!kit.sku) missing.push("sku");
  if (!kit.name) missing.push("title");
  if (
    !Number.isSafeInteger(kit.final_sale_price_minor) ||
    Number(kit.final_sale_price_minor) < 0
  )
    missing.push("final_sale_price_minor");
  if (!kit.packaging_instruction_version)
    missing.push("packaging_instruction_version");
  if (!kit.installation_guide_version)
    missing.push("installation_guide_version");
  if (detail.status === "INCOMPLETE" || detail.missing_mappings.length)
    missing.push(
      ...detail.missing_mappings.map((value: string) => `mapping:${value}`),
    );

  const components: KitPublicationProposal["components"] = [];
  for (const line of detail.connectors) {
    if (!line.product_id || !line.catalog_version_ref)
      missing.push(`connector:${line.connector_role}`);
    else
      components.push({
        productId: line.product_id,
        catalogVersionRef: line.catalog_version_ref,
        quantityBaseInt: Number(line.quantity),
        role: String(line.connector_role),
      });
  }
  for (const line of detail.complementary_items) {
    const catalog = db
      .prepare(
        "SELECT catalog_version_ref FROM complementary_products WHERE id=?",
      )
      .get(line.complementary_product_id) as any;
    if (!catalog?.catalog_version_ref)
      missing.push(`complementary:${line.complementary_product_id}`);
    else
      components.push({
        productId: line.complementary_product_id,
        catalogVersionRef: catalog.catalog_version_ref,
        quantityBaseInt: complementaryBaseQuantity(line),
        role: "COMPLEMENTARY",
      });
  }

  let profileCutPlan: KitPublicationProposal["profileCutPlan"] = null;
  if (detail.profile) {
    const profile = db
      .prepare("SELECT catalog_version_ref FROM profiles WHERE id=?")
      .get(detail.profile.profile_id) as any;
    if (!profile?.catalog_version_ref) missing.push("profile_catalog_version");
    else if (!detail.cuts.length) missing.push("profile_cuts");
    else
      profileCutPlan = {
        profileProductId: detail.profile.profile_id,
        catalogVersionRef: profile.catalog_version_ref,
        cuts: detail.cuts.map((cut: any) => ({
          quantity: Number(cut.quantity),
          lengthMm: Number(cut.length_mm),
          label: cut.label || null,
        })),
      };
  }

  const packages = (
    db
      .prepare(
        "SELECT * FROM kit_packaging_packages WHERE variant_id=? ORDER BY package_number",
      )
      .all(variantId) as any[]
  ).map((pack) => ({
    packageNumber: Number(pack.package_number),
    dimensionsMm: {
      length: pack.length_mm,
      width: pack.width_mm,
      height: pack.height_mm,
    },
    targetWeightGrams: pack.target_weight_grams,
    items: (
      db
        .prepare(
          "SELECT product_id,quantity_base_int FROM kit_packaging_items WHERE package_id=? ORDER BY product_id",
        )
        .all(pack.id) as any[]
    ).map((item) => ({
      productId: item.product_id,
      quantityBaseInt: Number(item.quantity_base_int),
    })),
  }));
  if (!packages.length) missing.push("packaging_packages");
  if (packages.some((pack) => pack.items.length === 0))
    missing.push("packaging_items");
  if (missing.length) return { missing: [...new Set(missing)] };

  const source = {
    workspaceKitId: kit.id as string,
    workspaceVersionId: `kit-studio:${variantId}:${detail.updated_at}`,
    publishedKitId: kit.published_kit_id || null,
    sku: kit.sku as string,
    title: kit.name as string,
    description: kit.description || null,
    components,
    profileCutPlan,
    packagingPlan: {
      packageCount: packages.length,
      instructionVersion: kit.packaging_instruction_version as string,
      installationGuideVersion: kit.installation_guide_version as string,
      packages,
    },
    finalSalePriceMinor: Number(kit.final_sale_price_minor),
    currency: "TRY" as const,
  };
  return {
    proposal: {
      ...source,
      authoredContentHash: authoredKitContentHash(source),
    },
    missing: [],
  };
}
