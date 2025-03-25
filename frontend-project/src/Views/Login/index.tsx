import React, { useState, useEffect } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import { Button, Form, Input, message } from "antd";
import { LockOutlined } from "@ant-design/icons";
import "./style.css";

const LoginPage: React.FC = () => {
  // Track login state
  const [isLogin, setIsLogin] = useState(false);
  // Ant Design form instance for validation and form control
  const [form] = Form.useForm();
  // React Router hook for redirecting after login
  const navigate = useNavigate();

  // Called when user submits the form
  const handleSubmit = async () => {
    try {
      // Validate input fields (especially the password)
      const values = await form.validateFields();
      // Format data as URL-encoded form data
      const formData = new URLSearchParams();
      formData.append("password", values.password);

      // Send login request to backend
      const res = await axios.post("/api/login", formData, {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded", // Matches how backend expects it
        },
      });

      // If backend returns success, mark user as logged in
      if (res.data?.data) {
        setIsLogin(true);
      } else {
        message.error("Log In Failure!"); // Server responded with failure
      }
    } catch (error) {
      // Catch validation or network errors
      message.error("Validation failed or request error.");
    }
  };

  // ⛳ navigate after login success
  useEffect(() => {
    if (isLogin) {
      navigate("/");
    }
  }, [isLogin, navigate]);

  return (
    <div className="login-page">
      <Form form={form} className="login-form" onFinish={handleSubmit}>
        <Form.Item
          name="password"
          rules={[{ required: true, message: "Please input your Password!" }]}
        >
          <Input
            prefix={<LockOutlined style={{ color: "rgba(0,0,0,.25)" }} />}
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
