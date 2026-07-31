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

  ctx.fillStyle = "#f8fafc";
  ctx.font = "700 38px sans-serif";
  ctx.fillText("Dzienne legit repy", 58, 66);
  ctx.fillStyle = "#94a3b8";
  ctx.font = "22px sans-serif";
  ctx.fillText(dateKey, 60, 100);

  roundedRect(ctx, 925, 35, 215, 84, 18);
  ctx.fillStyle = "rgba(59, 130, 246, 0.16)";
  ctx.fill();
  ctx.fillStyle = "#93c5fd";
  ctx.font = "18px sans-serif";
  ctx.fillText("ŁĄCZNIE", 950, 67);
  ctx.fillStyle = "#ffffff";
  ctx.font = "700 36px sans-serif";
  ctx.fillText(String(total), 950, 105);

  const values = Array.from({ length: 24 }, (_, hour) =>
    Math.max(0, Number(hourly?.[hour] || 0)),
  );
  const maxValue = Math.max(1, ...values);
  const chart = { x: 70, y: 155, width: 1070, height: 385 };

  ctx.strokeStyle = "rgba(148, 163, 184, 0.18)";
  ctx.lineWidth = 1;
  ctx.fillStyle = "#718096";
  ctx.font = "15px sans-serif";
  for (let line = 0; line <= 4; line++) {
    const y = chart.y + (chart.height * line) / 4;
    ctx.beginPath();
    ctx.moveTo(chart.x, y);
    ctx.lineTo(chart.x + chart.width, y);
    ctx.stroke();
    const label = Math.round(maxValue * (1 - line / 4));
    ctx.fillText(String(label), 28, y + 5);
  }

  const slotWidth = chart.width / 24;
  const barWidth = Math.max(12, slotWidth - 12);
  for (let hour = 0; hour < 24; hour++) {
    const value = values[hour];
    const barHeight = value === 0 ? 3 : (value / maxValue) * chart.height;
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
      ctx.font = "700 13px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(String(value), x + barWidth / 2, Math.max(chart.y + 15, y - 8));
    }

    if (hour % 2 === 0) {
      ctx.fillStyle = "#94a3b8";
      ctx.font = "14px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(String(hour).padStart(2, "0"), x + barWidth / 2, 568);
    }
  }
  ctx.textAlign = "left";

  ctx.fillStyle = "#64748b";
  ctx.font = "16px sans-serif";
  const updateLabel = updatedAt
    ? new Intl.DateTimeFormat("pl-PL", {
        timeZone: "Europe/Warsaw",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }).format(new Date(updatedAt))
    : "--:--:--";
  ctx.fillText(`Ostatnia aktualizacja: ${updateLabel}`, 70, 620);
  ctx.textAlign = "right";
  ctx.fillText("Godzina (Europe/Warsaw)", 1140, 620);

  return canvas.toBuffer("image/png");
}

module.exports = { renderDailyLegitChart };
