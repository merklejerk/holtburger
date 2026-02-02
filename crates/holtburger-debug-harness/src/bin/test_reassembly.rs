use holtburger_core::session::Session;
use holtburger_core::protocol::messages::FragmentHeader;
use std::net::SocketAddr;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let addr: SocketAddr = "127.0.0.1:9001".parse()?;
    let mut session = Session::new(addr).await?;

    let frag1_data = vec![1u8; 448];
    let frag2_data = vec![2u8; 156];

    let header1 = FragmentHeader {
        sequence: 147,
        id: 0x80000000,
        count: 2,
        size: 448,
        index: 0,
        queue: 1,
    };

    let header2 = FragmentHeader {
        sequence: 147,
        id: 0x80000000,
        count: 2,
        size: 156,
        index: 1,
        queue: 1,
    };

    println!("Feeding fragment 2/2 (OUT-OF-ORDER)...");
    let res_early = session.process_fragment(&header2, &frag2_data);
    assert!(res_early.is_none());

    println!("Feeding fragment 1/2...");
    let res_final = session.process_fragment(&header1, &frag1_data);
    
    if let Some(total) = res_final {
        println!("Full message size: {}", total.len());
        assert_eq!(total.len(), 448 + 156);
        assert_eq!(&total[..448], &frag1_data);
        assert_eq!(&total[448..], &frag2_data);
        println!("SUCCESS: Reassembly works perfectly with correct sequence key!");
    } else {
        println!("ERROR: Reassembly failed!");
        std::process::exit(1);
    }

    Ok(())
}
