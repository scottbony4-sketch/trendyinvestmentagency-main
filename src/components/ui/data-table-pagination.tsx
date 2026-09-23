type DataTablePaginationProps = {
  page: number;
  totalPages: number;
  rowsPerPage: number;
  onPageChange: (page: number) => void;
  onRowsPerPageChange: (rowsPerPage: number) => void;
  totalItems: number;
  startIndex: number;
  endIndex: number;
};

export function DataTablePagination({
  page,
  totalPages,
  rowsPerPage,
  onPageChange,
  onRowsPerPageChange,
  totalItems,
  startIndex,
  endIndex,
}: DataTablePaginationProps) {
  const firstVisiblePage = Math.min(Math.max(page - 1, 1), Math.max(totalPages - 2, 1));
  const pageNumbers = Array.from(
    { length: Math.min(3, totalPages) },
    (_, index) => firstVisiblePage + index,
  );

  return (
    <div className="flex flex-col gap-3 border-t border-border/60 bg-background/50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="text-sm text-muted-foreground">
        {totalItems === 0 ? "No results" : `Showing ${startIndex + 1}-${endIndex} of ${totalItems}`}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>Rows</span>
          <select
            value={rowsPerPage}
            onChange={(event) => onRowsPerPageChange(Number(event.target.value))}
            className="rounded-md border border-border bg-background px-2 py-1 text-sm focus:border-primary focus:outline-none"
          >
            <option value={5}>5</option>
            <option value={10}>10</option>
            <option value={25}>25</option>
            <option value={50}>50</option>
          </select>
        </label>

        <div className="flex items-center gap-1">
          <button
            disabled={page <= 1}
            onClick={() => onPageChange(Math.max(1, page - 1))}
            className="rounded-md border border-border bg-background px-3 py-1.5 text-sm text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 hover:text-foreground"
          >
            Prev
          </button>

          {pageNumbers.map((number) => (
            <button
              key={number}
              onClick={() => onPageChange(number)}
              className={`min-w-9 rounded-md border px-2.5 py-1.5 text-sm ${
                page === number
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-background text-muted-foreground hover:text-foreground"
              }`}
            >
              {number}
            </button>
          ))}

          <button
            disabled={page >= totalPages}
            onClick={() => onPageChange(Math.min(totalPages, page + 1))}
            className="rounded-md border border-border bg-background px-3 py-1.5 text-sm text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 hover:text-foreground"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
