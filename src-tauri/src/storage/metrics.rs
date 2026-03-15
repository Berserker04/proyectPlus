// ---------------------------------------------------------------------------
// storage/metrics.rs — sondas de red y métricas del sistema operativo.
// Responsabilidad: detectar si un puerto está en uso (TCP probe).
// En el futuro: historial de CPU/RAM por servicio, GPU, etc.
// ---------------------------------------------------------------------------

use std::{
    net::{SocketAddr, TcpStream},
    time::Duration,
};

/// Comprueba si hay algo escuchando en 127.0.0.1:<port>.
/// Timeout corto (80 ms) para no bloquear el refresco del dashboard.
pub fn is_port_open(port: u16) -> bool {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    TcpStream::connect_timeout(&addr, Duration::from_millis(80)).is_ok()
}
