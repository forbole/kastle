export type WalletConnections = {
  [walletId: string]: AccountConnectionsByNetwork;
};

type AccountConnectionsByNetwork = {
  [accountIndex: number]: NetworkConnections;
};

type NetworkConnections = {
  [networkId: string]: AccountConnection[];
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
  networkId: string,
): AccountConnection[] {
  const connections = walletConnections?.[walletId];
  if (!connections) {
    return [];
  }

  const accountConnectionsByNetwork = connections[accountIndex] ?? {};
  return accountConnectionsByNetwork[networkId] ?? [];
}

export function addConnection(
  walletConnections: WalletConnections,
  walletId: string,
  accountIndex: number,
  networkId: string,
  connection: AccountConnection,
): WalletConnections {
  const connections = getAccountConnections(
    walletConnections,
    walletId,
    accountIndex,
    networkId,
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
      [accountIndex]: {
        ...walletConnections[walletId]?.[accountIndex],
        [networkId]: updatedConnections,
      },
    },
  };
}

export function removeConnection(
  walletConnections: WalletConnections,
  walletId: string,
  accountIndex: number,
  networkId: string,
  host: string,
): WalletConnections {
  const connections = getAccountConnections(
    walletConnections,
    walletId,
    accountIndex,
    networkId,
  );

  const updatedConnections = connections.filter(
    (connection) => connection.host !== host,
  );

  return {
    ...walletConnections,
    [walletId]: {
      ...walletConnections[walletId],
      [accountIndex]: {
        ...walletConnections[walletId]?.[accountIndex],
        [networkId]: updatedConnections,
      },
    },
  };
}

export function isConnected(connections: AccountConnection[], host: string) {
  return connections.map((connection) => connection.host).includes(host);
}
