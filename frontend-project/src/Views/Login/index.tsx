import React, { useState } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import { Button, Form, Input, message } from "antd";
import { LockOutlined } from "@ant-design/icons";
import "./style.css";

const LoginPage: React.FC = () => {
  const [isLogin, setIsLogin] = useState(false);
  const [form] = Form.useForm();
  const navigate = useNavigate();

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      const formData = new URLSearchParams();
      formData.append("password", values.password);

      const res = await axios.post("/api/login", formData, {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      });

      if (res.data?.data) {
        setIsLogin(true);
      } else {
        message.error("Log In Failure!");
      }
    } catch (error) {
      message.error("Validation failed or request error.");
    }
  };

  if (isLogin) {
    navigate("/");
  }

  return (
    <div className="login-page">
      <Form form={form} className="login-form" onFinish={handleSubmit}>
        <Form.Item
          name="password"
          rules={[{ required: true, message: "Please input your Password!" }]}
        >
          <Input
            prefix={<LockOutlined style={{ color: 'rgba(0,0,0,.25)' }} />}
            type="password"
            placeholder="Password"
          />
        </Form.Item>

        <Form.Item>
          <Button block type="primary" htmlType="submit">
            Log in
          </Button>
        </Form.Item>
      </Form>
    </div>
  );
};

export default LoginPage;
