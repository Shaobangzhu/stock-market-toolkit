import React from "react";
import { LockOutlined } from "@ant-design/icons";
import { Button, Form, Input } from "antd";
import "./login.css";

const App: React.FC = () => {
  const onFinish = (values: any) => {
    console.log("Received values of form: ", values);
  };

  return (
    <div className="login-page">
      <Form
        name="login"
        initialValues={{ remember: true }}
        style={{ maxWidth: 360 }}
        onFinish={onFinish}
      >
        <Form.Item
          name="password"
          rules={[{ required: true, message: "Please input your Password!" }]}
        >
          <Input
            prefix={<LockOutlined />}
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

export default App;
