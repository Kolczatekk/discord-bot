const { createCanvas } = require("@napi-rs/canvas");

function roundedRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function renderDailyLegitChart({ dateKey, hourly, total, updatedAt }) {
  const width = 1200;
  const height = 650;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  const background = ctx.createLinearGradient(0, 0, width, height);
  background.addColorStop(0, "#07111f");
  background.addColorStop(1, "#101d35");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);

  const values = Array.from({ length: 24 }, (_, hour) =>
    Math.max(0, Number(hourly?.[hour] || 0)),
  );
  const maxValue = Math.max(1, ...values);
  const bestValue = Math.max(...values);
  const bestHour = bestValue > 0 ? values.indexOf(bestValue) : null;
  const displayDate = /^\d{4}-\d{2}-\d{2}$/.test(dateKey || "")
    ? `${dateKey.slice(8, 10)}.${dateKey.slice(5, 7)}.${dateKey.slice(0, 4)}`
    : dateKey;

  ctx.fillStyle = "#f8fafc";
  ctx.font = "700 34px Arial";
  ctx.fillText("ILE REPÓW DOSTALIŚMY DZISIAJ?", 58, 58);
  ctx.fillStyle = "#94a3b8";
  ctx.font = "20px Arial";
  ctx.fillText(displayDate, 60, 91);

  roundedRect(ctx, 58, 118, 500, 120, 22);
  ctx.fillStyle = "rgba(37, 99, 235, 0.23)";
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.font = "700 66px Arial";
  ctx.fillText(String(total), 88, 200);
  ctx.fillStyle = "#dbeafe";
  ctx.font = "700 25px Arial";
  ctx.fillText(total === 1 ? "+rep wystawiono dzisiaj" : "+repów wystawiono dzisiaj", 175, 181);
  ctx.fillStyle = "#93c5fd";
  ctx.font = "18px Arial";
  ctx.fillText("To jest dzisiejszy wynik", 176, 211);

  roundedRect(ctx, 585, 118, 557, 120, 22);
  ctx.fillStyle = "rgba(15, 23, 42, 0.62)";
  ctx.fill();
  ctx.fillStyle = "#94a3b8";
  ctx.font = "18px Arial";
  ctx.fillText("NAJWIĘCEJ REPÓW BYŁO", 615, 157);
  ctx.fillStyle = "#f8fafc";
  ctx.font = "700 32px Arial";
  ctx.fillText(
    bestHour === null
      ? "Jeszcze nie było żadnego"
      : `O ${String(bestHour).padStart(2, "0")}:00  —  ${bestValue} ${bestValue === 1 ? "rep" : "repów"}`,
    615,
    203,
  );

  ctx.fillStyle = "#cbd5e1";
  ctx.font = "18px Arial";
  ctx.fillText("Każdy niebieski słupek pokazuje, ile repów było w danej godzinie.", 60, 276);

  const chart = { x: 75, y: 306, width: 1065, height: 230 };
  const scaleStep = Math.max(1, Math.ceil(maxValue / 4));
  const scaleMax = Math.max(1, Math.ceil(maxValue / scaleStep) * scaleStep);

  ctx.strokeStyle = "rgba(148, 163, 184, 0.18)";
  ctx.lineWidth = 1;
  ctx.fillStyle = "#718096";
  ctx.font = "15px Arial";
  const lineCount = Math.min(4, scaleMax);
  for (let line = 0; line <= lineCount; line++) {
    const value = line * scaleStep;
    const y = chart.y + chart.height - (value / scaleMax) * chart.height;
    ctx.beginPath();
    ctx.moveTo(chart.x, y);
    ctx.lineTo(chart.x + chart.width, y);
    ctx.stroke();
    ctx.textAlign = "right";
    ctx.fillText(String(value), 58, y + 5);
  }

  const slotWidth = chart.width / 24;
  const barWidth = Math.max(12, slotWidth - 12);
  for (let hour = 0; hour < 24; hour++) {
    const value = values[hour];
    const barHeight = value === 0 ? 3 : (value / scaleMax) * chart.height;
    const x = chart.x + hour * slotWidth + (slotWidth - barWidth) / 2;
    const y = chart.y + chart.height - barHeight;
    const gradient = ctx.createLinearGradient(0, y, 0, chart.y + chart.height);
    gradient.addColorStop(0, "#60a5fa");
    gradient.addColorStop(1, "#2563eb");
    roundedRect(ctx, x, y, barWidth, barHeight, 6);
    ctx.fillStyle = gradient;
    ctx.fill();

    if (value > 0) {
      ctx.fillStyle = "#dbeafe";
      ctx.font = "700 13px Arial";
      ctx.textAlign = "center";
      ctx.fillText(String(value), x + barWidth / 2, Math.max(chart.y + 15, y - 8));
    }

    if (hour % 3 === 0 || hour === 23) {
      ctx.fillStyle = "#94a3b8";
      ctx.font = "14px Arial";
      ctx.textAlign = "center";
      ctx.fillText(`${String(hour).padStart(2, "0")}:00`, x + barWidth / 2, 563);
    }
  }
  ctx.textAlign = "left";

  ctx.fillStyle = "#64748b";
  ctx.font = "16px Arial";
  const updateLabel = updatedAt
    ? new Intl.DateTimeFormat("pl-PL", {
        timeZone: "Europe/Warsaw",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }).format(new Date(updatedAt))
    : "--:--:--";
  ctx.fillText(`Zaktualizowano o ${updateLabel}`, 75, 620);
  ctx.textAlign = "right";
  ctx.fillText("Wynik od 00:00 do teraz", 1140, 620);

  return canvas.toBuffer("image/png");
}

module.exports = { renderDailyLegitChart };
