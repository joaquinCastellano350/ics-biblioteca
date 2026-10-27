# HU-03: author search and catalog filtering

Both endpoints are public and return JSON. They are served by the existing
Express application and use the shared Prisma database connection.

## Search authors

`GET /api/authors?q=ana` returns authors whose names contain the query,
case-insensitively. `q` is optional; without it, the endpoint returns all
authors. The result is independent of the current book catalog and has this
shape:

```json
{
  "authors": [
    { "id": "UUID", "name": "Author name" }
  ]
}
```

The catalog's **Autores** button opens a dropdown menu. Its search field calls
this endpoint after 500 ms without further typing; results come from the authors endpoint and
are independent of the books currently loaded in the catalog. Each result has a
checkbox, so visitors can select multiple authors.

Selections inside the open menu are provisional. **Limpiar** clears the
provisional selection, and **Listo** applies it to the catalog and closes the
menu. Closing the menu or pressing Escape cancels provisional changes and
keeps the previously applied filters. Applied authors appear as removable
chips below the catalog controls; removing a chip immediately updates the
catalog results.

A new edit cancels the pending timer and any previous client request immediately.
Closing the menu or leaving the catalog cancels pending author searches too.
Cancelling a browser request does not guarantee that a query already received by
the server stops running; the delay prevents unnecessary requests from starting.

## Filter books by authors

`GET /api/books?authorIds=UUID1&authorIds=UUID2` accepts the same parameter
repeated for each selected author ID. A book matches when it has at least one
of the selected authors (OR). With no `authorIds`, the catalog is unfiltered.
The response keeps the existing `{ "books": [...] }` contract.

Author IDs are carried in a criteria object through the existing route,
controller, and repository layers so later catalog criteria can be combined
without replacing the active author selection.
