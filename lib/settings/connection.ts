import z from "zod";

const AccountConnectionSchema = z.object({
  host: z.string(),
  name: z.string().optional(),
  icon: z.string().optional(),
});

const AccountConnectionsSchema = z.array(AccountConnectionSchema);

export type WalletConnections = {
  [walletId: string]: AccountConnections;
};

type AccountConnections = {
  [accountIndex: number]: AccountConnection[];
};

type AccountConnection = {
  host: string;
  name?: string;
  icon?: string;
};

export function getAccountConnections(
  walletConnections: WalletConnections,
  walletId: string,
  accountIndex: number,
): AccountConnection[] {
  const connections = walletConnections?.[walletId];
  if (!connections) {
    return [];
  }

  const accountConnections = AccountConnectionsSchema.safeParse(
    connections[accountIndex],
  );
  if (!accountConnections.success) {
    return [];
  }

  return accountConnections.data;
}

export function addConnection(
  walletConnections: WalletConnections,
  walletId: string,
  accountIndex: number,
  connection: AccountConnection,
): WalletConnections {
  const connections = getAccountConnections(
    walletConnections,
    walletId,
    accountIndex,
  );

  const updatedConnections = connections
    .map((c) => c.host)
    .includes(connection.host)
    ? connections
    : [...connections, connection];

  return {
    ...walletConnections,
    [walletId]: {
      ...walletConnections[walletId],
      [accountIndex]: updatedConnections,
    },
  };
}

export function removeConnection(
  walletConnections: WalletConnections,
  walletId: string,
  accountIndex: number,
  host: string,
): WalletConnections {
  const connections = getAccountConnections(
    walletConnections,
    walletId,
    accountIndex,
  );

  const updatedConnections = connections.filter(
    (connection) => connection.host !== host,
  );

  return {
    ...walletConnections,
    [walletId]: {
      ...walletConnections[walletId],
      [accountIndex]: updatedConnections,
    },
  };
}

export function isConnected(connections: AccountConnection[], host: string) {
  return connections.map((connection) => connection.host).includes(host);
}
