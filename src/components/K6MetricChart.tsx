import { useEffect, useRef } from "react";
import { LineChart } from "echarts/charts";
import { GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
import { init, use } from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import type { K6MetricPoint } from "@/lib/domain/models";

use([LineChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer]);

type ChartSeries = {
  name: string;
  color: string;
  points: K6MetricPoint[];
};

type K6MetricChartProps = {
  title: string;
  subtitle: string;
  series: ChartSeries[];
  yAxisLabel: string;
};

export function K6MetricChart(props: K6MetricChartProps) {
  const chartRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!chartRef.current) {
      return undefined;
    }

    const chart = init(chartRef.current);
    chart.setOption({
      animation: false,
      backgroundColor: "transparent",
      color: props.series.map((item) => item.color),
      grid: {
        left: 42,
        right: 18,
        top: 48,
        bottom: 28,
      },
      legend: {
        top: 10,
        textStyle: {
          color: "rgba(222, 232, 247, 0.78)",
          fontSize: 11,
        },
      },
      tooltip: {
        trigger: "axis",
        valueFormatter: (value) => (typeof value === "number" ? value.toFixed(2) : String(value)),
      },
      xAxis: {
        type: "category",
        boundaryGap: false,
        axisLabel: {
          color: "rgba(201, 215, 236, 0.72)",
          fontSize: 11,
        },
        axisLine: {
          lineStyle: {
            color: "rgba(155, 180, 214, 0.18)",
          },
        },
        data: props.series[0]?.points.map((point) =>
          new Date(point.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
        ) ?? [],
      },
      yAxis: {
        type: "value",
        name: props.yAxisLabel,
        nameTextStyle: {
          color: "rgba(201, 215, 236, 0.68)",
          padding: [0, 0, 0, 6],
        },
        splitLine: {
          lineStyle: {
            color: "rgba(155, 180, 214, 0.1)",
          },
        },
        axisLabel: {
          color: "rgba(201, 215, 236, 0.72)",
          fontSize: 11,
        },
      },
      series: props.series.map((item) => ({
        type: "line",
        name: item.name,
        smooth: true,
        symbol: "none",
        lineStyle: {
          width: 2,
        },
        areaStyle: {
          opacity: 0.08,
        },
        data: item.points.map((point) => point.value),
      })),
    });

    const resizeObserver = new ResizeObserver(() => {
      chart.resize();
    });
    resizeObserver.observe(chartRef.current);

    return () => {
      resizeObserver.disconnect();
      chart.dispose();
    };
  }, [props.series, props.title, props.subtitle, props.yAxisLabel]);

  return (
    <article className="k6-chart-card">
      <div className="section-heading">
        <div>
          <h5>{props.title}</h5>
          <p className="chart-subtitle">{props.subtitle}</p>
        </div>
      </div>
      <div ref={chartRef} className="k6-chart-surface" />
    </article>
  );
}
