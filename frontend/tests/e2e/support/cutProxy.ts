/**
 * A CONNECT proxy the test can sever and restore.
 *
 * `context.setOffline(true)` flips `navigator.onLine`, which is the EASY
 * outage: the browser tells the app the cable is out. The outage a shop
 * actually gets is the other one — Wi-Fi up, ISP dead — where the browser
 * still says online and only the server has gone. Routing the browser through
 * this proxy makes that outage real: `sever()` refuses new tunnels AND kills
 * the live ones (the realtime socket dies the way a dead uplink kills it),
 * while `navigator.onLine` stays true. `restore()` brings the uplink back.
 */
import http from "node:http";
import net from "node:net";

export class CutProxy {
	private server: http.Server;
	private sockets = new Set<net.Socket>();
	private cut = false;
	readonly port: number;

	constructor(port: number) {
		this.port = port;
		this.server = http.createServer((_req, res) => {
			// Plain-HTTP proxying is not needed for an https lab; refuse loudly.
			res.statusCode = 502;
			res.end("cut-proxy: only CONNECT is supported");
		});
		this.server.on("connect", (req, clientSocket, head) => {
			if (this.cut) {
				clientSocket.destroy();
				return;
			}
			const [host, portText] = String(req.url || "").split(":");
			const upstream = net.connect(Number(portText) || 443, host, () => {
				clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
				if (head?.length) upstream.write(head);
				upstream.pipe(clientSocket);
				clientSocket.pipe(upstream);
			});
			this.sockets.add(clientSocket);
			this.sockets.add(upstream);
			const drop = () => {
				this.sockets.delete(clientSocket);
				this.sockets.delete(upstream);
				clientSocket.destroy();
				upstream.destroy();
			};
			upstream.on("error", drop);
			clientSocket.on("error", drop);
			upstream.on("close", drop);
			clientSocket.on("close", drop);
		});
	}

	listen() {
		return new Promise<void>((resolve, reject) => {
			this.server.once("error", reject);
			this.server.listen(this.port, "127.0.0.1", () => resolve());
		});
	}

	/** Uplink dead: refuse new tunnels and kill every live one. */
	sever() {
		this.cut = true;
		for (const socket of this.sockets) socket.destroy();
		this.sockets.clear();
	}

	/** Uplink back. Existing connections were already killed by `sever`. */
	restore() {
		this.cut = false;
	}

	close() {
		this.sever();
		return new Promise<void>((resolve) => this.server.close(() => resolve()));
	}
}
