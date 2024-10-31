import { Company, Customer, Order, Store } from '@ZoppyTech/models';
import { StoreDistributionHelper } from './process-winner-store';
import { Op } from 'sequelize';

export class OrderStoreDistributionHelper {
    public static async execute(order: Order, customer: Customer): Promise<void> {
        if (!order.companyId) return;
        await this.processOrder(order, customer);
    }

    public static async processOrder(order: Order, customer: Customer) {
        if (!customer.phone) return;

        const company: Company = await this.getCompany(order.companyId);
        if (!company || (await StoreDistributionHelper.isCompanyBlocked(company))) return;

        const stores: Store[] = await this.getCompanyStores(company.id);
        const mapCustomersByPhone: Map<string, Customer[]> = await this.getCustomersGroupedByPhone(company, [customer.phone]);
        const orders: Order[] = await this.getCustomerOrders(customer.id);

        const mapPhoneStores: any = StoreDistributionHelper.mapOrdersToStoresByPhone(stores, [...orders, order], mapCustomersByPhone);
        const championStoresByPhone: any = StoreDistributionHelper.getChampionStoresByPhone(mapPhoneStores);

        await StoreDistributionHelper.updateChampionStoreForCustomers(championStoresByPhone, mapCustomersByPhone);
    }

    private static async getCompany(companyId: string): Promise<Company | null> {
        return await Company.findOne({ where: { id: companyId } });
    }

    private static async getCompanyStores(companyId: string): Promise<Store[]> {
        return await Store.findAll({ where: { companyId } });
    }

    private static async getCustomerOrders(customerId: string): Promise<Order[]> {
        return await Order.findAll({ where: { customerId } });
    }

    private static async getCustomersGroupedByPhone(company: Company, phones: string[]): Promise<Map<string, Customer[]>> {
        const customers: Customer[] = await Customer.findAll({
            where: {
                companyId: company.id,
                phone: { [Op.in]: phones }
            }
        });

        return customers.reduce((map: any, customer: Customer) => {
            if (!map.has(customer.phone)) {
                map.set(customer.phone, []);
            }
            map.get(customer.phone).push(customer);
            return map;
        }, new Map<string, Customer[]>());
    }
}
