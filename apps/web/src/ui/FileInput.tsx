import { UploadOutlined } from "@ant-design/icons";
import { Button, Upload, type ButtonProps } from "antd";

// What Form.Item says about the field reaches the control a person lands on
type FieldAria = Pick<ButtonProps, "aria-describedby" | "aria-invalid" | "aria-required">;

interface FileInputProps extends FieldAria {
  id?: string;
  // The field's label reaches only the hidden input, and a screen reader would say just «Обрати файл»
  label: string;
  accept: string;
  value?: File | null;
  onChange?: (file: File | null) => void;
}

// A file as a form holds it: it goes to the server when the form is saved, not when it is chosen
export function FileInput({ id, label, accept, value, onChange, ...aria }: FileInputProps) {
  return (
    <Upload
      id={id}
      accept={accept}
      maxCount={1}
      beforeUpload={() => false}
      fileList={value ? [{ uid: value.name, name: value.name }] : []}
      onChange={({ fileList }) => onChange?.(fileList[0]?.originFileObj ?? null)}
    >
      <Button icon={<UploadOutlined />} aria-label={`${label}: обрати файл`} {...aria}>
        Обрати файл
      </Button>
    </Upload>
  );
}
