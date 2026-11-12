import Link from "next/link";
import { redirect } from "next/navigation";
import Workspace from "@/components/Workspace";
import { createServerSupabase } from "@/lib/supabase-server";
import { colorFor } from "@/lib/utils";

export default async function Page({ params }: { params: Promise<{ room: string }> }) {
  const { room: raw } = await params;
  const slug = decodeURIComponent(raw);
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/w/${slug}`)}`);

  // RLS: a non-member gets no row (and can't tell whether the room exists)
  const { data: room } = await supabase
    .from("rooms")
    .select("id, slug, name, owner_id")
    .eq("slug", slug)
    .maybeSingle();

  if (!room) {
    return (
      <main className="home">
        <div className="home-card">
          <div className="logo">
            كتشنيلي <span>وورك</span>
          </div>
          <p>الغرفة دي مش موجودة، أو مش عضو فيها. اطلب لينك دعوة من صاحب الغرفة.</p>
          <Link className="btn" href="/">
            رجوع
          </Link>
        </div>
      </main>
    );
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", user.id)
    .maybeSingle();
  const name = profile?.display_name || user.email?.split("@")[0] || "مستخدم";

  return (
    <Workspace
      room={{ id: room.id, slug: room.slug, name: room.name, ownerId: room.owner_id }}
      me={{ id: user.id, name, color: colorFor(user.id) }}
    />
  );
}
