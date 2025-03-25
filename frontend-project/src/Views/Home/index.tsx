import React, { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Button, message } from "antd";
import ReactEcharts from "echarts-for-react";
import axios from "axios";
import moment from "moment";
import "./style.css";

// Type definition for a single stock entry
interface StockData {
  company_name: string;
  price: number;
}

// Type definition for a line chart dataset
interface LineData {
  name: string;
  type: string;
  data: number[];
}

const Home: React.FC = () => {
  // Track if initial data load is complete
  const [loaded, setLoaded] = useState(false);
  // Track login state (used to redirect if not logged in)
  const [isLogin, setIsLogin] = useState(true);
  // Store stock data grouped by timestamp
  const [data, setData] = useState<{ [key: string]: StockData[] }>({});
  // Hook for programmatic navigation
  const navigate = useNavigate();

  // On initial load: check login and fetch stock data
  useEffect(() => {
    const fetchData = async () => {
      try {
        // Check if the user is logged in
        const loginRes = await axios.get("/api/isLogin");
        if (!loginRes.data?.data) {
          setIsLogin(false); // Trigger redirect
        }
        setLoaded(true); // Mark component as ready to render

        // Fetch previously saved stock data
        const dataRes = await axios.get("/api/showData");
        if (dataRes.data?.data) {
          setData(dataRes.data.data);
        }
      } catch (error) {
        message.error("Error fetching data");
      }
    };
    fetchData();
  }, []);

  // Redirect to login page if user is not logged in
  useEffect(() => {
    if (!isLogin) {
      navigate("/login");
    }
  }, [isLogin, navigate]);

  // Handle log out button click
  const handleLogoutClick = async () => {
    try {
      const res = await axios.get("/api/logout");
      if (res.data?.data) {
        setIsLogin(false); // Will trigger redirect
      } else {
        message.error("Log Out Failed!");
      }
    } catch (error) {
      message.error("Logout request failed");
    }
  };

  // Handle get new data button click
  const handleGetDataClick = async () => {
    try {
      const res = await axios.get("/api/getData");
      if (res.data?.data) {
        message.success("Get Data succeeded!");
      } else {
        message.error("Get Data failed!");
      }
    } catch (error) {
      message.error("Get Data failed!");
    }
  };

  // Generate ECharts option from stock data
  const getOption = useCallback(() => {
    const companyNames: string[] = [];
    const times: string[] = [];
    const tempData: { [key: string]: number[] } = {};

    // Group and organize data for chart
    Object.entries(data).forEach(([timestamp, items]) => {
      times.push(moment(Number(timestamp)).format("MM-DD HH:mm"));

      items.forEach(({ company_name, price }) => {
        if (!companyNames.includes(company_name)) {
          companyNames.push(company_name);
        }

        // Push price to the correct company's array
        tempData[company_name]
          ? tempData[company_name].push(price)
          : (tempData[company_name] = [price]);
      });
    });

    // Convert data to chart-friendly format
    const result: LineData[] = Object.entries(tempData).map(
      ([name, values]) => ({
        name,
        type: "line",
        data: values,
      })
    );

    // Return final ECharts option object
    return {
      title: {
        text: "Stock Prices for Company in My Watch List",
      },
      tooltip: { trigger: "axis" },
      legend: { data: companyNames },
      grid: { left: "3%", right: "4%", bottom: "3%", containLabel: true },
      xAxis: { type: "category", boundaryGap: false, data: times },
      yAxis: { type: "value" },
      series: result,
    };
  }, [data]);

  // Prevent render before data is ready
  if (!loaded) return null;
  
  return (
    <div className="home-page">
      <div className="buttons">
        <Button
          type="primary"
          style={{ marginLeft: "10px" }}
          onClick={handleGetDataClick}
        >
          Get Data
        </Button>
        <Button type="primary" onClick={handleLogoutClick}>
          Log Out
        </Button>
      </div>
      <ReactEcharts option={getOption()} />
    </div>
  );
};

export default Home;
