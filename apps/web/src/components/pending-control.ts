/** Pending is an interaction lock, separate from an unavailable action's disabled appearance. */
export function pendingControlProps(pending: boolean, disabled = false) {
  return {
    disabled: disabled || pending,
    'aria-busy': pending || undefined,
    'data-pending': pending && !disabled || undefined,
    'data-action-pending': pending || undefined,
  }
}
