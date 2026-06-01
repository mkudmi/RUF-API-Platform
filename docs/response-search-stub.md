# Response Search Stub

Local stub API for checking manual JSONata search and AI search against predictable JSON responses.

## Run

```bash
npm run mock:response-search
```

Optional custom port:

```bash
RESPONSE_SEARCH_STUB_PORT=7799 npm run mock:response-search
```

## Service URLs

- Health: `http://127.0.0.1:7788/__health`
- Cases index: `http://127.0.0.1:7788/__cases`

## Available cases

- `GET /api/section-codes`
  Root object with `values[]`, repeated digits inside dates, and `section_code` filters.

- `GET /api/orders`
  Root object with `items[]`, several business fields, and alternative list naming.

- `GET /api/nested-records`
  Nested collection under `payload.records[]`.

- `GET /api/audit-events`
  Mixed arrays, counts, booleans, and overlapping numeric fragments.

- `GET /api/single-match-envelope`
  Root object with `rows[]` where some filters return one record.

## Suggested checks in Ruf

1. Create a request to one of the endpoints above and run it.
2. Open response search and try manual JSONata.
3. Turn on AI search and ask in natural language for filtered records.
4. Compare:
   - whether the result shape preserves the target collection
   - whether `Matches` equals the number of returned records
   - whether highlighting sticks to the intended field/value instead of unrelated dates or counters

## Why these cases exist

- Different collection names: `values`, `items`, `records`, `rows`, `events`
- Different nesting levels: root list and nested list
- Overlapping digits in dates and counters
- Single-match and multi-match filters
- String, number, boolean, and object fields in one dataset
