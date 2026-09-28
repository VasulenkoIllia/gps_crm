import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App as AntApp, ConfigProvider } from "antd";
import ukUA from "antd/locale/uk_UA";
import dayjs from "dayjs";
import "dayjs/locale/uk";
import App from "./App";
import { DemoStoreProvider } from "./store/DemoStore";
import "./styles.css";

dayjs.locale("uk");

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ConfigProvider
      locale={ukUA}
      theme={{
        token: {
          colorPrimary: "#2a78d6",
          borderRadius: 8,
          fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
          colorBgLayout: "#f6f6f4",
        },
      }}
    >
      <AntApp>
        <BrowserRouter>
          <DemoStoreProvider>
            <App />
          </DemoStoreProvider>
        </BrowserRouter>
      </AntApp>
    </ConfigProvider>
  </React.StrictMode>,
);
