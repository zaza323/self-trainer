import { LoginForm } from "@/shared/ui/forms/auth-forms";
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center p-4"><LoginForm next={next} /></main>;
}
