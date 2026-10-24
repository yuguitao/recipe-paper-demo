# Public food observations

These files contain factual public records and derived sample statistics, not synthetic values.

- `latest.json`: published observation package and source status.
- `latest.js`: the same package for the website and offline preview.
- `history.json`: deduplicated observed records retained for 30 days.
- `price-seed.json` and `popularity-seed.json`: initial verified captures, retained for reproducible setup; the scheduled collector reads the live sources.

See [DATA-SOURCES.md](../DATA-SOURCES.md) for attribution, definitions, timestamps, schedules and failure handling. Original date, collection time, and bundle generation time have different meanings. Missing data is not filled with synthetic records.
