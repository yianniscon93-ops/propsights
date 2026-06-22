export default function NotFound() {
  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center"
      style={{ background: "#0C100A", color: "#D0DCC0" }}
    >
      <h1 className="font-display font-bold text-6xl uppercase mb-4" style={{ color: "#FFFFFF" }}>
        404
      </h1>
      <p style={{ color: "#6E7D62" }}>Page not found.</p>
      <a
        href="/"
        className="mt-8 px-6 py-3 rounded-xl text-sm font-semibold text-white"
        style={{ background: "#4A5E3A" }}
      >
        Back home
      </a>
    </div>
  );
}
