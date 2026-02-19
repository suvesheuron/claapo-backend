declare module 'razorpay' {
  interface RazorpayOptions {
    key_id: string;
    key_secret: string;
  }

  interface OrderCreateOptions {
    amount: number;
    currency: string;
    receipt: string;
    notes?: Record<string, string>;
  }

  interface Order {
    id: string;
  }

  interface Orders {
    create(options: OrderCreateOptions): Promise<Order>;
  }

  export default class Razorpay {
    constructor(options: RazorpayOptions);
    orders: Orders;
  }
}
