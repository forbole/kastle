import { RouterProvider } from "react-router-dom";
import { router } from "@/entrypoints/popup/router.tsx";

export default function App() {
  return <RouterProvider router={router} />;
}
