import assert from "node:assert/strict";
import { test } from "node:test";
import { mapPanelConnector, parseConnectorSku } from "./compatibilityMapper.js";

test("structured square Panel fields map to a normalized compatibility group", () => {
  const mapped = mapPanelConnector({ id: "1", sku: "anything", form_code: "ELB", tube_type_code: "SQ", normalized_pipe_size: "20x20 mm", normalized_material: "Alüminyum" });
  assert.equal(mapped.status, "COMPATIBLE");
  assert.equal(mapped.source, "STRUCTURED");
  assert.equal(mapped.compatibility_group, "SQ-20X20");
  assert.equal(mapped.compatible_material_group, "ALUMINUM");
});

test("DSDST SKU parser derives material, shape, mapped inch size and arbitrary model", () => {
  const carbon = parseConnectorSku("CS-S25-6W");
  assert.deepEqual({ material: carbon.compatible_material_group, shape: carbon.profile_shape, group: carbon.compatibility_group, role: carbon.connector_role }, { material: "CARBON_STEEL", shape: "SQUARE", group: "SQ-25X25", role: "6W" });
  const premium = parseConnectorSku("PCI-R100-AFB");
  assert.deepEqual({ material: premium.compatible_material_group, group: premium.compatibility_group, nominal: premium.nominal_size, role: premium.connector_role }, { material: "PREMIUM_CAST_IRON", group: "RD-33.7", nominal: '1"', role: "AFB" });
});

test("structured nominal round size maps one inch to 33.7 mm outside diameter", () => {
  const mapped = mapPanelConnector({ id: "2", sku: "anything", form_code: "TEE", normalized_tube_type: "Yuvarlak", normalized_pipe_size: '1"' });
  assert.equal(mapped.compatibility_group, "RD-33.7");
  assert.equal(mapped.outside_diameter_mm, 33.7);
});

test("a single structured square size is expanded to equal dimensions", () => {
  const mapped = mapPanelConnector({ id: "single", sku: "anything", form_code: "BAS", tube_type_code: "S", normalized_size: "40 mm" });
  assert.equal(mapped.compatibility_group, "SQ-40X40");
});

test("SKU parsing is an explicit fallback and unresolved rows remain unselectable", () => {
  const fallback = mapPanelConnector({ id: "3", sku: "AL-R100-3W" });
  assert.equal(fallback.status, "COMPATIBLE");
  assert.equal(fallback.source, "SKU_FALLBACK");
  assert.equal(fallback.compatibility_group, "RD-33.7");
  const unresolved = mapPanelConnector({ id: "4", sku: "UNKNOWN", title: "Belirsiz" });
  assert.equal(unresolved.status, "UNRESOLVED");
  assert.equal(unresolved.source, null);
});
