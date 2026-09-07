interface Props {
  url: string | null;
  name: string;
  own?: boolean;
}

export default function AppIcon({ url, name, own }: Props) {
  return url ? (
    <img src={url} alt="" className="w-11 h-11 rounded-2xl object-cover shrink-0" />
  ) : (
    <div
      className={`w-11 h-11 rounded-2xl flex items-center justify-center font-bold text-base shrink-0 ${own ? "bg-[#595DD2] text-white" : "bg-[#f3f4f6] text-[#6b7280]"}`}
    >
      {name.charAt(0)}
    </div>
  );
}
