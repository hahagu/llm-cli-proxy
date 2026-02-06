import { query } from "../_generated/server";
import { authComponent } from "../auth";

export const currentUser = query({
  async handler(ctx) {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) return null;

    return {
      _id: user._id,
      name: user.name ?? null,
      email: user.email ?? null,
      image: user.image ?? null,
      emailVerified: user.emailVerified ?? false,
      createdAt: user.createdAt ?? null,
      updatedAt: user.updatedAt ?? null,
    };
  },
});
