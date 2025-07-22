import React, { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Button, message, Select } from "antd";
import ReactEcharts from "echarts-for-react";
import axios from "axios";
import "./style.css";

const { Option } = Select;

interface VolumePoint {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

type VolumeData = {
  [date: string]: VolumePoint[];
};

const Volume: React.FC = () => {
  const [data, setData] = useState<VolumeData>({});
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [isLogin, setIsLogin] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const fetchData = async () => {
      try {
        const loginRes = await axios.get("/api/isLogin");
        if (!loginRes.data?.data) {
          setIsLogin(false);
        }

        const dataRes = await axios.get("/api/showSingleStockVolume");
        if (dataRes.data?.data) {
          const result: VolumeData = dataRes.data.data;
          setData(result);
          const dates = Object.keys(result);
          if (dates.length > 0) {
            setSelectedDate(dates[0]); // 默认选第一天
          }
        }
        setLoaded(true);
      } catch (error) {
        message.error("Failed to load volume data");
      }
    };

    fetchData();
  }, []);

  useEffect(() => {
    if (!isLogin) {
      navigate("/login");
    }
  }, [isLogin, navigate]);

  const handleGetDataClick = async () => {
    try {
      const res = await axios.get("/api/getSingleStockVolume");
      if (res.data?.data) {
        message.success("Volume Data fetched successfully!");
      } else {
        message.error("Failed to fetch volume data.");
      }
    } catch (error) {
      message.error("Failed to fetch volume data.");
    }
  };

  const handleLogoutClick = async () => {
    try {
      const res = await axios.get("/api/logout");
      if (res.data?.data) {
        setIsLogin(false);
      } else {
        message.error("Logout failed!");
      }
    } catch (error) {
      message.error("Logout failed!");
    }
  };

  const getOption = useCallback(() => {
    const times: string[] = [];
    const volumes: number[] = [];
    const prices: number[] = [];

    data[selectedDate]?.forEach((item) => {
      times.push(item.time);
      volumes.push(item.volume);
      prices.push(item.close); // <-- 修复点
    });

    return {
      title: {
        text: `${selectedDate} OPEN Intraday Volume & Price`,
      },
      tooltip: {
        trigger: "axis",
        formatter: (params: any) => {
          const [bar, line] = params;
          return `
          ${bar.axisValue}<br/>
          <span style="color:${bar.color}">■</span> Volume: ${bar.data}<br/>
          <span style="color:${line.color}">■</span> Price: ${line.data}
        `;
        },
      },
      legend: {
        data: ["Volume", "Price"],
      },
      xAxis: {
        type: "category",
        data: times,
      },
      yAxis: [
        {
          type: "value",
          name: "Volume",
        },
        {
          type: "value",
          name: "Price",
          position: "right",
        },
      ],
      series: [
        {
          name: "Volume",
          type: "bar",
          data: volumes,
        },
        {
          name: "Price",
          type: "line",
          yAxisIndex: 1,
          data: prices,
        },
      ],
    };
  }, [data, selectedDate]);

  if (!loaded) return null;

  return (
    <div className="volume-page">
      <div className="buttons">
        <Select
          value={selectedDate}
          onChange={setSelectedDate}
          style={{ width: 160, marginRight: 10 }}
        >
          {Object.keys(data).map((date) => (
            <Option key={date} value={date}>
              {date}
            </Option>
          ))}
        </Select>
        <Button type="primary" onClick={handleGetDataClick}>
          Get Data
        </Button>
        <Button
          type="primary"
          onClick={handleLogoutClick}
          style={{ marginLeft: 10 }}
        >
          Log Out
        </Button>
      </div>
      <ReactEcharts option={getOption()} style={{ height: 500 }} />
    </div>
  );
};

export default Volume;
