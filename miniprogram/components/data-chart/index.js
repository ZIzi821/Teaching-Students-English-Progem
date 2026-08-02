const DEFAULT_GREEN = "#4f8f73";
const EMPTY_COLOR = "#ece5da";

Component({
  properties: {
    type: {
      type: String,
      value: "donut",
    },
    segments: {
      type: Array,
      value: [],
    },
    points: {
      type: Array,
      value: [],
    },
    centerValue: {
      type: String,
      value: "0",
    },
    centerLabel: {
      type: String,
      value: "",
    },
    ariaLabel: {
      type: String,
      value: "学习数据图表",
    },
  },

  observers: {
    "type,segments,points,centerValue,centerLabel": function () {
      this.scheduleDraw();
    },
  },

  lifetimes: {
    ready() {
      this.isReady = true;
      this.scheduleDraw();
    },
  },

  methods: {
    scheduleDraw() {
      if (!this.isReady) return;
      if (this.drawTimer) clearTimeout(this.drawTimer);
      this.drawTimer = setTimeout(() => {
        this.drawTimer = null;
        this.draw();
      }, 30);
    },

    draw() {
      this.createSelectorQuery()
        .select("#chartCanvas")
        .fields({ node: true, size: true })
        .exec((result) => {
          const field = result && result[0];
          if (!field || !field.node || !field.width || !field.height) return;
          const canvas = field.node;
          const context = canvas.getContext("2d");
          const pixelRatio = wx.getWindowInfo ? wx.getWindowInfo().pixelRatio : wx.getSystemInfoSync().pixelRatio;
          canvas.width = field.width * pixelRatio;
          canvas.height = field.height * pixelRatio;
          context.scale(pixelRatio, pixelRatio);
          context.clearRect(0, 0, field.width, field.height);
          if (this.data.type === "bar") {
            this.drawBars(context, field.width, field.height);
          } else {
            this.drawDonut(context, field.width, field.height);
          }
        });
    },

    drawDonut(context, width, height) {
      const segments = (this.data.segments || [])
        .map((item) => Object.assign({}, item, { value: Math.max(0, Number(item.value) || 0) }))
        .filter((item) => item.value > 0);
      const total = segments.reduce((sum, item) => sum + item.value, 0);
      const centerX = width / 2;
      const centerY = height / 2;
      const radius = Math.min(width, height) * 0.31;
      const lineWidth = Math.max(12, radius * 0.3);
      context.lineWidth = lineWidth;
      context.lineCap = "round";
      context.strokeStyle = EMPTY_COLOR;
      context.beginPath();
      context.arc(centerX, centerY, radius, 0, Math.PI * 2);
      context.stroke();

      if (total > 0) {
        let start = -Math.PI / 2;
        segments.forEach((segment) => {
          const angle = (segment.value / total) * Math.PI * 2;
          context.strokeStyle = segment.color || DEFAULT_GREEN;
          context.beginPath();
          context.arc(centerX, centerY, radius, start, start + Math.max(0, angle - 0.025));
          context.stroke();
          start += angle;
        });
      }

      context.fillStyle = "#243f35";
      context.font = "700 28px sans-serif";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(String(this.data.centerValue || "0"), centerX, centerY - 8);
      context.fillStyle = "#817669";
      context.font = "13px sans-serif";
      context.fillText(String(this.data.centerLabel || ""), centerX, centerY + 22);
    },

    drawBars(context, width, height) {
      const points = (this.data.points || []).map((item) => ({
        label: String(item.label || ""),
        value: Math.max(0, Number(item.value) || 0),
        goal: Math.max(0, Number(item.goal) || 0),
      }));
      const padding = { top: 18, right: 12, bottom: 34, left: 12 };
      const chartWidth = Math.max(0, width - padding.left - padding.right);
      const chartHeight = Math.max(0, height - padding.top - padding.bottom);
      const maxValue = Math.max(1, ...points.map((item) => Math.max(item.value, item.goal)));
      const gap = points.length ? chartWidth / points.length : chartWidth;
      const barWidth = Math.min(26, gap * 0.48);

      context.strokeStyle = "#e7ded1";
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(padding.left, padding.top + chartHeight);
      context.lineTo(width - padding.right, padding.top + chartHeight);
      context.stroke();

      points.forEach((point, index) => {
        const x = padding.left + gap * index + gap / 2;
        const heightRatio = point.value / maxValue;
        const barHeight = Math.max(point.value ? 4 : 0, chartHeight * heightRatio);
        context.fillStyle = point.goal > 0 && point.value >= point.goal ? "#4f8f73" : "#b9d7c9";
        context.beginPath();
        if (context.roundRect) {
          context.roundRect(x - barWidth / 2, padding.top + chartHeight - barHeight, barWidth, barHeight, 6);
        } else {
          context.rect(x - barWidth / 2, padding.top + chartHeight - barHeight, barWidth, barHeight);
        }
        context.fill();
        context.fillStyle = "#4f6f63";
        context.font = "600 12px sans-serif";
        context.textAlign = "center";
        context.fillText(String(point.value), x, padding.top + chartHeight - barHeight - 8);
        context.fillStyle = "#817669";
        context.font = "11px sans-serif";
        context.fillText(point.label, x, height - 10);
      });
    },
  },
});
