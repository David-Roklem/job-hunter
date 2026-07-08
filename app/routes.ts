import { type RouteConfig } from "@react-router/dev/routes";
import { flatRoutes } from "@react-router/fs-routes";

/**
 * File-based routing: каждый маршрут — файл в app/routes/.
 * Co-located loader/action, типизация через Route.LoaderArgs (routing.md).
 */
export default flatRoutes() satisfies RouteConfig;
