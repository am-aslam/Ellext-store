export function LoadingAnimation({ label = 'Loading' }: { label?: string }) {
  return <div className="loading-animation" role="status" aria-label={label}>
    <span className="loading-animation-art" aria-hidden="true" />
    <span>{label}</span>
  </div>;
}
