const status = document.querySelector("#status");

try {
  const response = await fetch("/api/health");
  const health = await response.json();
  status.textContent = `API: ${health.status}`;
} catch {
  status.textContent = "API unavailable";
}
