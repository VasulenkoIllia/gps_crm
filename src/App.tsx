import { Navigate, Route, Routes } from "react-router-dom";
import AppLayout from "./layout/AppLayout";
import Dashboard from "./pages/Dashboard";
import Subscribers from "./pages/Subscribers";
import SubscriberCard from "./pages/SubscriberCard";
import Objects from "./pages/Objects";
import ObjectCard from "./pages/ObjectCard";
import Payments from "./pages/Payments";
import Equipment from "./pages/Equipment";
import Mailings from "./pages/Mailings";
import References from "./pages/References";
import Roles from "./pages/Roles";

export default function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<Dashboard />} />
        <Route path="subscribers" element={<Subscribers />} />
        <Route path="subscribers/:id" element={<SubscriberCard />} />
        <Route path="objects" element={<Objects />} />
        <Route path="objects/:id" element={<ObjectCard />} />
        <Route path="payments" element={<Payments />} />
        <Route path="equipment" element={<Equipment />} />
        <Route path="mailings" element={<Mailings />} />
        <Route path="references" element={<References />} />
        <Route path="roles" element={<Roles />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
