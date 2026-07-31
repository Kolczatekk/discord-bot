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

function drawValuePill(ctx, text, x, y) {
  ctx.font = "700 22px Arial";
  const width = ctx.measureText(text).width + 24;
  roundedRect(ctx, x, y - 25, width, 34, 7);
  ctx.fillStyle = "#353740";
  ctx.fill();
  ctx.strokeStyle = "#4b4e5a";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = "#e5e7eb";
  ctx.fillText(text, x + 12, y);
  return width;
}

function drawRowIcon(ctx, label, y, color) {
  roundedRect(ctx, 62, y - 25, 42, 36, 9);
  ctx.fillStyle = "#30323b";
  ctx.fill();
  ctx.strokeStyle = "#454957";
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.font = "700 18px Arial";
  ctx.textAlign = "center";
  ctx.fillText(label, 83, y);
  ctx.textAlign = "left";
}

function renderDailyLegitChart({ dateKey, hourly, total, updatedAt }) {
  const width = 1000;
  const height = 560;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#1e1f22";
  ctx.fillRect(0, 0, width, height);
  roundedRect(ctx, 20, 18, 960, 524, 16);
  ctx.fillStyle = "#242529";
  ctx.fill();
  ctx.strokeStyle = "#34363c";
  ctx.stroke();

  roundedRect(ctx, 20, 18, 8, 524, 5);
  const accent = ctx.createLinearGradient(20, 18, 20, 542);
  accent.addColorStop(0, "#7c6cff");
  accent.addColorStop(1, "#5865f2");
  ctx.fillStyle = accent;
  ctx.fill();

  const values = Array.from({ length: 24 }, (_, hour) =>
    Math.max(0, Number(hourly?.[hour] || 0)),
  );
  const bestValue = Math.max(...values);
  const bestHour = bestValue > 0 ? values.indexOf(bestValue) : null;
  const displayDate = /^\d{4}-\d{2}-\d{2}$/.test(dateKey || "")
    ? `${dateKey.slice(8, 10)}.${dateKey.slice(5, 7)}.${dateKey.slice(0, 4)}`
    : String(dateKey || "-");

  roundedRect(ctx, 55, 48, 62, 62, 13);
  ctx.fillStyle = "#343746";
  ctx.fill();
  ctx.fillStyle = "#7c8cff";
  ctx.fillRect(68, 73, 9, 24);
  ctx.fillStyle = "#59c98d";
  ctx.fillRect(82, 62, 9, 35);
  ctx.fillStyle = "#ff637d";
  ctx.fillRect(96, 82, 9, 15);

  ctx.fillStyle = "#f5f5f5";
  ctx.font = "700 38px Arial";
  ctx.fillText("Dzienny licznik legit repów", 135, 91);
  ctx.fillStyle = "#aeb1b8";
  ctx.font = "18px Arial";
  ctx.fillText("Proste podsumowanie aktywności z dzisiaj", 136, 119);

  ctx.fillStyle = "#555861";
  roundedRect(ctx, 48, 145, 6, 164, 3);
  ctx.fill();

  const rows = [
    { icon: "D", label: "Dzisiejsza data:", value: displayDate, color: "#8ca0ff" },
    { icon: "+", label: "Wystawione legit repy:", value: String(total), color: "#58d68d" },
    {
      icon: "H",
      label: "Najwięcej repów:",
      value: bestHour === null ? "Jeszcze brak" : `${String(bestHour).padStart(2, "0")}:00 (${bestValue})`,
      color: "#ffca5c",
    },
  ];

  rows.forEach((row, index) => {
    const y = 181 + index * 55;
    drawRowIcon(ctx, row.icon, y, row.color);
    ctx.fillStyle = "#c7c9cf";
    ctx.font = "700 22px Arial";
    ctx.fillText(row.label, 122, y);
    const labelWidth = ctx.measureText(row.label).width;
    drawValuePill(ctx, row.value, 136 + labelWidth, y);
  });

  ctx.fillStyle = "#f1f2f4";
  ctx.font = "700 21px Arial";
  ctx.fillText("Aktywność w ciągu dnia", 55, 356);
  ctx.fillStyle = "#9da0a8";
  ctx.font = "17px Arial";
  ctx.fillText("Im wyższy słupek, tym więcej repów w tej godzinie", 55, 382);

  const chart = { x: 55, y: 405, width: 890, height: 76 };
  const slot = chart.width / 24;
  const maxValue = Math.max(1, ...values);
  for (let hour = 0; hour < 24; hour++) {
    const value = values[hour];
    const barHeight = value === 0 ? 5 : Math.max(10, (value / maxValue) * chart.height);
    const x = chart.x + hour * slot + 7;
    const y = chart.y + chart.height - barHeight;
    roundedRect(ctx, x, y, 22, barHeight, 5);
    ctx.fillStyle = value > 0 ? "#6d7cff" : "#3c3f48";
    ctx.fill();
  }

  ctx.fillStyle = "#8e929a";
  ctx.font = "14px Arial";
  ctx.textAlign = "center";
  [0, 6, 12, 18, 23].forEach((hour) => {
    const x = chart.x + hour * slot + 18;
    ctx.fillText(`${String(hour).padStart(2, "0")}:00`, x, 506);
  });
  ctx.textAlign = "left";

  const updateLabel = updatedAt
    ? new Intl.DateTimeFormat("pl-PL", {
        timeZone: "Europe/Warsaw",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(updatedAt))
    : "--:--";
  ctx.fillStyle = "#b9bbc1";
  ctx.font = "700 16px Arial";
  ctx.fillText("New Shop", 55, 535);
  ctx.fillStyle = "#777b84";
  ctx.font = "16px Arial";
  ctx.fillText(`• aktualizacja ${updateLabel}`, 135, 535);

  return canvas.toBuffer("image/png");
}

module.exports = { renderDailyLegitChart };
