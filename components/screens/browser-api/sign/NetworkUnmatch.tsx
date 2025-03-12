export default function NetworkUnmatched({ network }: { network: string }) {
  return (
    <div className="p-4 text-white">
      <h1>NetworkUnmatched</h1>
      <span>
        Network Id does not match, please switch network to {network}
      </span>
    </div>
  );

}
