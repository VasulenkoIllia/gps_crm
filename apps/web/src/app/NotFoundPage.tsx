import { Button, Result } from "antd";
import { useNavigate } from "react-router";
import { usePageTitle } from "../ui";

const TITLE = "Сторінку не знайдено";

export function NotFoundPage() {
  const navigate = useNavigate();
  usePageTitle(TITLE);

  return (
    <Result
      status="404"
      title={TITLE}
      subTitle="Перевірте адресу або поверніться на головну."
      extra={
        <Button type="primary" onClick={() => void navigate("/")}>
          На головну
        </Button>
      }
    />
  );
}
