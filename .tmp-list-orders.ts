import { prisma } from "./src/lib/prisma"

async function main() {
  const orders = await prisma.order.findMany({
    where: {
      status: "PAID",
      user: { email: "awadgiorgio@gmail.com" },
    },
    orderBy: { createdAt: "desc" },
    take: 15,
    include: {
      user: { select: { name: true, email: true } },
      orderItems: {
        include: {
          ticketType: {
            include: {
              event: { select: { title: true } },
            },
          },
        },
      },
    },
  })

  for (const order of orders) {
    const ticketCount = order.orderItems.reduce((sum, item) => sum + item.quantity, 0)
    console.log(
      JSON.stringify({
        id: order.id,
        createdAt: order.createdAt,
        paidAt: order.paidAt,
        totalAmount: order.totalAmount,
        eventTitle: order.orderItems[0]?.ticketType.event.title ?? null,
        ticketCount,
      })
    )
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
