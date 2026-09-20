# Catalog CSV Inspector

A small, local command-line tool for mapping supplier CSV columns to a fixed product schema and preparing files for review. It preserves supplied identifiers, records limited title/price normalizations, reports duplicates, and holds incomplete or conflicting product groups for a decision.

**This is file preparation, not a Shopify importer or an import guarantee.** The destination file is named `shopify-draft-products.csv`, but no store connection or live import has been tested. This AI-assisted code and documentation were created for Catalog Cleanup Studio; the included example is entirely synthetic, not customer work.

## Run the synthetic example

Requires Node.js; verified with Node.js 24.19.0. There are no packages to install, network calls, API keys, or hosted processing.

```sh
node prepare_catalog.mjs --help
node prepare_catalog.mjs --input examples/supplier-input.csv --mapping examples/supplier-mapping.json --out-dir example-output
```

Run from this directory. `example-output` must not exist, and its parent directory must already exist. A successful process exits with code 0 and writes `delivery.json` last, after reading back and hashing the outputs. Re-running into the same directory fails rather than overwriting it.

The example has **5 records: 3 prepared, 1 held for a missing price, and 1 duplicate**. The prepared records form two complete products. SKUs such as `00127` remain strings. `prepared_with_exceptions` means the command completed with unresolved decisions; it does not mean the whole catalog is ready.

## Explicit source-column mapping

`examples/supplier-mapping.json` is the complete configuration for the fixture. For example:

| Supplier column | Destination column |
| --- | --- |
| `group_id` | `Handle` |
| `display_name` | `Title` |
| `item_code` | `Variant SKU` |
| `unit_price_usd` | `Variant Price` |
| `supplier_note` | Retained in the original file only |

Every destination field needs one source column or an allowed explicit constant. Every source column must be mapped or listed in `retainOnly` with a reason. Required product facts are never guessed. Constants are limited to draft/unpublished status, inventory policy, manual fulfillment, and permitted optional blanks.

The fixture records `status: "synthetic"` and `currency: "USD"`. For real inputs, agree the field mapping and operational settings first, then record `status: "agreed"` and the actual agreement reference. Setting that flag does not itself establish agreement. The command also accepts its exact native columns without `--mapping`; see `headers` in `catalog_transform.mjs`.

## Outputs and review

- `input-original.csv`: unchanged supplier input; the native-schema path calls it `source-feed.csv`.
- `field-mapping.csv` and `mapping.json`: mapping decisions and the configuration used, when supplied.
- `shopify-draft-products.csv`: complete product groups that passed this tool's local checks.
- `exceptions.csv`, `change-log.csv`, and `duplicates.csv`: missing/conflicting facts, proposed normalizations, and duplicate record references.
- `delivery.json`: counts, source-record references, completion status, and output hashes. `liveImportVerified` remains `false`.

Review exceptions and the actual destination's requirements before importing anything. Record references count the CSV header as record 1; embedded newlines inside quoted cells do not add records. Duplicate comparison uses mapped destination fields; retained-only notes remain in the original and do not affect that comparison.

## Current limits

- UTF-8, comma-separated CSV only; **1–250 source records and at most 10 MiB**. No Excel workbook input or output.
- Fixed, limited product schema for new draft/unpublished products, confirmed USD unit prices, and manual fulfillment. No existing-store updates, inventory-quantity reconciliation, images, descriptions, currency conversion, or inferred identifiers.
- Only surrounding title whitespace and accepted USD price notation are normalized. Ambiguous prices and conflicting variants need a decision; a problem in one variant holds its entire product group.
- Formula-like cells starting with `=`, `+`, `-`, or `@` after leading whitespace/control characters are rejected before output. Legitimate identifiers with those prefixes also require another agreed review format.
- Local checks cannot verify that supplied facts, tax settings, shipping flags, or the chosen mapping are commercially correct. Generated files contain the original input; keep private inputs and deliveries outside any public repository.

Need help preparing a supplier file? [Catalog Cleanup Studio offers a $4 starter for up to 50 rows and a $9 pilot for up to 250 rows](https://catalog-cleanup-studio.omribe.chatgpt.site), with scope and mapping agreed before payment.

Need a small JavaScript repair? [NebulaKit offers browser-game and website fixes from $4](https://itch.io/t/6922450/programmerpaid-small-browser-game-website-fixes-from-4). Local script changes can be assessed separately. Work uses AI assistance; the exact scope, price, acceptance checks and delivery date are agreed before paid work.

## License

MIT. See `LICENSE`. No third-party runtime dependencies are bundled.
