# DSDST Kit Studio rules

Kit Studio is the bounded workspace for kit drafting, compatibility, cuts and authored versions. It is not the canonical catalog, cost, price, inventory, sales or finance authority. Read the binding V2 architecture in the checked-out `dsdst-operations/docs/architecture/` directory.

## Ownership

K owns editable kit drafts, design metadata, compatibility evaluation, cuts, draft variants, authored immutable versions and design uploads.

P owns product/SKU identity, typed UOM, current and historical acquisition cost, FX, tax/fee/price policy, sellable SKU, inventory and the immutable published-kit economic snapshot. `panel_connector_cache` is disposable/read-only; locally stored price/cost fields are design inputs until the core confirms them.

## Approval contract

- Freeze an authored version and content hash before submission.
- Submit to P with an idempotency key and referenced catalog versions.
- Display the core's complete economic preview; never fill missing policy with zero, rate 1 or a local default.
- Approval identifies the authorized human and exact proposal/core-policy hashes.
- Record P's publication ID/hash. Do not mutate the approved version in place.
- Current-cost refresh produces a simulation or a new draft/version, never rewrites an approved snapshot.
- Do not create a second sellable SKU or publish directly to marketplace/stock.

## Data and security

- Use fixed-precision UOM quantities and integer money. Preserve currency and FX provenance.
- Tax, full-bar/net consumption, kerf/waste, labor, packaging, fees and margin rules are `DECISION REQUIRED` until owner-approved; existing app defaults are not policy.
- Authenticate through P; enforce live user capability in the backend. The catalog service key grants only its declared read scope.
- No secrets/customer data in logs, errors, fixtures, exports or source control.
- Migrations are forward-only, fail closed, and tested on fresh/upgrade fixtures. They never perform hidden business repair.

Keep drafts/design behavior and useful snapshot tests. Do not broaden K into the business core, weaken tests, perform production data repair, deploy, restart or migrate without explicit authorization.
