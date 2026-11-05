const DEFAULT_GREEN = "#14645A";

Component({
  data: {
    resolvedAriaLabel: "学习数据图表",
    isBarEmpty: false,
    isLineEmpty: false,
    barRows: [],
    segmentRows: [],
  },

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
    "type,segments,points,centerValue,centerLabel,ariaLabel": function () {
      this.refreshChartMeta();
      this.refreshViewRows();
      this.scheduleDraw();
    },
  },

  lifetimes: {
    ready() {
      this.isReady = true;
      this.refreshChartMeta();
      this.refreshViewRows();
      this.scheduleDraw();
    },
    detached() {
      if (this.drawTimer) clearTimeout(this.drawTimer);
      this.drawTimer = null;
    },
  },

  methods: {
    normalizeBarPoints() {
      return (this.data.points || []).map((item, index) => ({
        label: String(item.label || `第${index + 1}天`),
        value: Math.max(0, Number(item.value) || 0),
        goal: Math.max(0, Number(item.goal) || 0),
      }));
    },

    normalizeLinePoints() {
      return (this.data.points || []).map((item, index) => ({
        label: String(item.label || `第${index + 1}点`),
        value: Math.max(0, Math.min(100, Number(item.value) || 0)),
      }));
    },

    refreshChartMeta() {
      const baseLabel = String(this.data.ariaLabel || "学习数据图表").trim() || "学习数据图表";
      if (this.data.type !== "bar" && this.data.type !== "line") {
        if (this.data.resolvedAriaLabel !== baseLabel || this.data.isBarEmpty || this.data.isLineEmpty) {
          this.setData({ resolvedAriaLabel: baseLabel, isBarEmpty: false, isLineEmpty: false });
        }
        return;
      }

      const isLine = this.data.type === "line";
      const points = isLine ? this.normalizeLinePoints() : this.normalizeBarPoints();
      const isEmpty = !points.some((point) => point.value > 0);
      const pointSummary = points
        .map((point) => {
          if (isLine) return `${point.label}：记忆保持 ${point.value}%`;
          const goalText = point.goal > 0 ? `，目标 ${point.goal}` : "";
          return `${point.label}：完成 ${point.value}${goalText}`;
        })
        .join("；");
      const stateText = isEmpty ? "暂无学习记录" : "";
      const detailText = pointSummary ? `每日数据：${pointSummary}` : "";
      const resolvedAriaLabel = [baseLabel, stateText, detailText].filter(Boolean).join("。");

      if (
        this.data.resolvedAriaLabel !== resolvedAriaLabel ||
        this.data.isBarEmpty !== (!isLine && isEmpty) ||
        this.data.isLineEmpty !== (isLine && isEmpty)
      ) {
        this.setData({ resolvedAriaLabel, isBarEmpty: !isLine && isEmpty, isLineEmpty: isLine && isEmpty });
      }
    },

    refreshViewRows() {
      if (this.data.type === "bar") {
        const points = this.normalizeBarPoints();
        const maxValue = Math.max(1, ...points.map((item) => Math.max(item.value, item.goal)));
        this.setData({
          barRows: points.map((point) => ({
            label: point.label,
            value: point.value,
            heightPercent: Math.round(point.value / maxValue * 100),
            goalPercent: point.goal > 0 ? Math.round(point.goal / maxValue * 100) : 0,
            met: point.goal > 0 && point.value >= point.goal,
          })),
        });
      } else if (this.data.type !== "line") {
        const segments = (this.data.segments || []).map((item) => Object.assign({}, item, {
          value: Math.max(0, Number(item.value) || 0),
          color: item.color || DEFAULT_GREEN,
        }));
        const total = segments.reduce((sum, item) => sum + item.value, 0);
        this.setData({
          segmentRows: segments.map((item) => Object.assign(item, {
            percent: total ? Math.round(item.value / total * 1000) / 10 : 0,
          })),
        });
      }
    },

    scheduleDraw() {
      if (!this.isReady || this.data.type !== "line") return;
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
          this.drawLine(context, field.width, field.height);
        });
    },

    drawLine(context, width, height) {
      const points = this.normalizeLinePoints();
      const padding = { top: 20, right: 14, bottom: 36, left: 36 };
      const chartWidth = Math.max(0, width - padding.left - padding.right);
      const chartHeight = Math.max(0, height - padding.top - padding.bottom);
      const baseline = padding.top + chartHeight;
      const xAt = (index) => points.length <= 1
        ? padding.left + chartWidth / 2
        : padding.left + chartWidth * index / (points.length - 1);
      const yAt = (value) => baseline - (value / 100) * chartHeight;

      [0, 50, 100].forEach((value) => {
        const y = yAt(value);
        context.strokeStyle = "#E8E4DA";
        context.lineWidth = 1;
        context.beginPath();
        context.moveTo(padding.left, y);
        context.lineTo(width - padding.right, y);
        context.stroke();
        context.fillStyle = "#7B837E";
        context.font = "10px sans-serif";
        context.textAlign = "right";
        context.fillText(`${value}%`, padding.left - 6, y + 3);
      });

      if (!points.length) return;
      context.strokeStyle = "#14645A";
      context.lineWidth = 2.5;
      context.lineJoin = "round";
      context.lineCap = "round";
      context.beginPath();
      points.forEach((point, index) => {
        const x = xAt(index);
        const y = yAt(point.value);
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      });
      context.stroke();
      points.forEach((point, index) => {
        const x = xAt(index);
        const y = yAt(point.value);
        context.fillStyle = "#FFFFFF";
        context.beginPath();
        context.arc(x, y, 4.5, 0, Math.PI * 2);
        context.fill();
        context.strokeStyle = "#14645A";
        context.lineWidth = 2;
        context.stroke();
        context.fillStyle = "#7B837E";
        context.font = "10px sans-serif";
        context.textAlign = "center";
        context.fillText(point.label, x, height - 10);
      });
    },
  },
});
