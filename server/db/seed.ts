import type Database from "better-sqlite3";

export function seedDevelopmentData(db: Database.Database) {
  db.prepare("INSERT OR IGNORE INTO app_settings (key,value) VALUES ('vat_rate_basis_points','2000')").run();
  const roles = ["ELB", "BAS", "TEE", "3W", "4W", "5W", "B4W", "LTE", "CRS", "CPL", "BCP", "45T"];
  const roleStmt = db.prepare("INSERT OR IGNORE INTO connector_roles (code,name) VALUES (?,?)");
  roles.forEach((role) => roleStmt.run(role, role));

  db.prepare("INSERT OR IGNORE INTO suppliers (id,name,contact_name,phone,email,active) VALUES ('sup-abc','ABC Metal','Ali Demir','+90 212 555 10 10','satis@abcmetal.test',1)").run();
  db.prepare("INSERT OR IGNORE INTO suppliers (id,name,contact_name,phone,email,active) VALUES ('sup-mob','Hareket Sistemleri','Zeynep Kaya','+90 216 555 20 20','teklif@hareket.test',1)").run();

  const specs = [
    ["spec-sq20", "SQUARE", "Aluminum", 20, 20, null, null, 1.5, "SQ-20X20"],
    ["spec-sq40", "SQUARE", "Aluminum", 40, 40, null, null, 2, "SQ-40X40"],
    ["spec-rd337", "ROUND", "Aluminum", null, null, 33.7, "1\"", 2, "RD-33.7"],
  ];
  const specStmt = db.prepare("INSERT OR IGNORE INTO profile_specs (id,shape,material,width_mm,height_mm,outside_diameter_mm,nominal_size,wall_thickness_mm,compatibility_group) VALUES (?,?,?,?,?,?,?,?,?)");
  specs.forEach((row) => specStmt.run(...row));

  const profiles = [
    ["profile-sq20", "spec-sq20", "Square 20×20 Aluminum", 6000, 0.32, 8000, 12000, 5000, "sup-abc"],
    ["profile-sq40", "spec-sq40", "Square 40×40 Aluminum", 6000, 0.78, 13800, 19800, 4348, "sup-abc"],
    ["profile-rd337", "spec-rd337", "Round 1\" Aluminum", 6000, 0.49, 10400, 15600, 5000, "sup-abc"],
  ];
  const profileStmt = db.prepare("INSERT OR IGNORE INTO profiles (id,spec_id,name,raw_length_mm,weight_per_meter_kg,purchase_price_per_meter_cents,sale_price_per_meter_cents,markup_basis_points,supplier_id) VALUES (?,?,?,?,?,?,?,?,?)");
  profiles.forEach((row) => profileStmt.run(...row));

  const complements = [
    ["comp-mdf", "MDF Tabla", "MDF-18", "18 mm kesilmiş MDF raf tablası", "M2", 19500, 28500, 4615, 3500, "sup-abc"],
    ["comp-wheel", "Frenli Tekerlek", "WH-75-B", "75 mm frenli endüstriyel tekerlek", "PIECE", 8500, 13500, 5882, 850, "sup-mob"],
    ["comp-pvc", "PVC Kaplama", "PVC-GR", "Gri profil kaplama şeridi", "METER", 2200, 3900, 7727, 90, "sup-abc"],
  ];
  const compStmt = db.prepare("INSERT OR IGNORE INTO complementary_products (id,name,sku_optional,description,unit_type,purchase_unit_price_cents,sale_unit_price_cents,markup_basis_points,weight_per_unit_grams,supplier_id) VALUES (?,?,?,?,?,?,?,?,?,?)");
  complements.forEach((row) => compStmt.run(...row));

  const connectorStmt = db.prepare("INSERT OR IGNORE INTO panel_connector_cache (product_id,sku,name_tr,name_en,material,form,size,purchase_cost_cents,sale_price_cents,unit_weight_grams,central_stock,panel_updated_at,compatibility_status,compatibility_source) VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'COMPATIBLE','MANUAL')");
  const compatibilityStmt = db.prepare("INSERT OR IGNORE INTO connector_compatibility (id,product_id,connector_role,profile_shape,profile_width_mm,profile_height_mm,outside_diameter_mm,nominal_size,compatible_material_group,wall_min_mm,wall_max_mm,compatibility_group) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)");
  for (const group of [
    { code: "S20", shape: "SQUARE", w: 20, h: 20, od: null, nominal: null, group: "SQ-20X20", sale: 12000, cost: 7200 },
    { code: "S40", shape: "SQUARE", w: 40, h: 40, od: null, nominal: null, group: "SQ-40X40", sale: 22000, cost: 14000 },
    { code: "R100", shape: "ROUND", w: null, h: null, od: 33.7, nominal: "1\"", group: "RD-33.7", sale: 18500, cost: 11900 },
  ]) {
    for (const role of ["ELB", "TEE", "BAS", "3W"]) {
      if (group.code === "R100" && role === "3W") continue;
      const id = `panel-${group.code.toLowerCase()}-${role.toLowerCase()}`;
      const sku = `AL-${group.code}-${role}`;
      connectorStmt.run(id, sku, `${role} bağlantı`, `${role} connector`, "Aluminum", group.shape, group.group, group.cost, group.sale, role === "TEE" ? 410 : 320, 48, "2026-09-01T00:00:00Z");
      compatibilityStmt.run(`compat-${id}`, id, role, group.shape, group.w, group.h, group.od, group.nominal, "ALUMINUM", 1, 3, group.group);
    }
  }
}
