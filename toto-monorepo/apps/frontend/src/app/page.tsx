import Link from "next/link";

export default function Home() {
  return (
    <div>
      <h1>Welcome to the TOTO Scanner</h1>
      <Link href="/upload">
        <button className="px-4 py-2 bg-blue-500 text-white rounded">Go to Upload Page</button>
      </Link>
    </div>
  );
}