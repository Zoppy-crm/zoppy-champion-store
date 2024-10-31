import { Company, Customer, Order, Store } from '@ZoppyTech/models';
import { BlockFreeTierHelper } from '@ZoppyTech/shared';
import { ArrayUtil, OrderStatusEnum, StoreTypeEnum } from '@ZoppyTech/utilities';
import { Op } from 'sequelize';

export class StoreDistributionHelper {
    public static CHUNK_SIZE = 15000;

    public static async execute(): Promise<void> {
        const companies: Company[] = await Company.findAll();

        for (const company of companies) {
            await this.processCompany(company);
        }
    }

    public static async processCompany(
        company: Company
    ): Promise<Record<string, { store: Store; totalOrders: number; totalValue: number }>> {
        if (await this.isCompanyBlocked(company)) return;

        const stores: Store[] = await this.getStoresByCompanyId(company.id);
        const phones: string[] = await this.getPagedPhones(company, this.CHUNK_SIZE);
        const customersByPhone: Map<string, Customer[]> = await this.getCustomersGroupedByPhone(company, phones);
        const customerIds: string[] = this.getCustomerIds(customersByPhone);
        const orders: Order[] = await this.getCompletedOrders(customerIds);

        const phoneStoreMap: Record<
            string,
            Record<string, { store: Store; totalOrders: number; totalValue: number }>
        > = this.mapOrdersToStoresByPhone(stores, orders, customersByPhone);
        const championStoresByPhone: Record<string, { store: Store; totalOrders: number; totalValue: number }> =
            this.getChampionStoresByPhone(phoneStoreMap);

        await this.updateChampionStoreForCustomers(championStoresByPhone, customersByPhone);
    }

    public static async isCompanyBlocked(company: Company) {
        return BlockFreeTierHelper.execute(company, null);
    }

    public static async getStoresByCompanyId(companyId: string): Promise<Store[]> {
        return Store.findAll({ where: { companyId } });
    }

    public static async getPagedPhones(company: Company, pageSize: number): Promise<string[]> {
        const uniquePhones: Customer[] = await Customer.findAll({
            where: {
                companyId: company.id,
                storeId: { [Op.eq]: null }
            },
            attributes: [[Customer.sequelize.fn('DISTINCT', Customer.sequelize.col('phone')), 'phone']],
            limit: pageSize
        });

        return uniquePhones.map((customer: Customer) => customer.phone);
    }

    public static async getCustomersGroupedByPhone(company: Company, phones: string[]): Promise<Map<string, Customer[]>> {
        const customers: Customer[] = await Customer.findAll({
            where: {
                companyId: company.id,
                storeId: { [Op.eq]: null },
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

    public static getCustomerIds(customersByPhone: Map<string, Customer[]>): string[] {
        return Array.from(customersByPhone.values()).flatMap((customers: Customer[]) => customers.map((customer: Customer) => customer.id));
    }

    public static async getCompletedOrders(customerIds: string[]): Promise<Order[]> {
        return Order.findAll({
            where: {
                status: OrderStatusEnum.COMPLETED,
                customerId: { [Op.in]: customerIds },
                storeId: { [Op.not]: null }
            }
        });
    }

    public static mapOrdersToStoresByPhone(
        stores: Store[],
        orders: Order[],
        customersByPhone: Map<string, Customer[]>
    ): Record<string, Record<string, { store: Store; totalOrders: number; totalValue: number }>> {
        const phoneStoreMap: Record<string, Record<string, { store: Store; totalOrders: number; totalValue: number }>> = {};

        const customerIdToPhoneMap: Map<string, string> = new Map<string, string>();
        for (const [phone, customers] of customersByPhone) {
            customers.forEach((customer: Customer) => {
                customerIdToPhoneMap.set(customer.id, phone);
            });
            phoneStoreMap[phone] = {};
        }

        const storeMap: Map<string, Store> = new Map(stores.map((store: Store) => [store.id, store]));

        for (const order of orders) {
            const phone: string = customerIdToPhoneMap.get(order.customerId);
            const store: Store = storeMap.get(order.storeId);

            if (phone && store) {
                if (!phoneStoreMap[phone][order.storeId]) {
                    phoneStoreMap[phone][order.storeId] = {
                        store,
                        totalOrders: 1,
                        totalValue: order.total
                    };
                } else {
                    phoneStoreMap[phone][order.storeId].totalOrders += 1;
                    phoneStoreMap[phone][order.storeId].totalValue += order.total;
                }
            }
        }

        return phoneStoreMap;
    }

    public static getChampionStoresByPhone(
        phoneStoreMap: Record<string, Record<string, { store: Store; totalOrders: number; totalValue: number }>>
    ): Record<string, { store: Store; totalOrders: number; totalValue: number }> {
        const championStores: Record<string, { store: Store; totalOrders: number; totalValue: number }> = {};

        for (const phone in phoneStoreMap) {
            let maxOrders: number = 0;
            let maxTotalValue: number = 0;
            let championStore: { store: Store; totalOrders: number; totalValue: number } | null = null;
            const hasShowRoom: boolean = Object.values(phoneStoreMap[phone]).some(
                (storeData: any) => storeData.store.type === StoreTypeEnum.SHOW_ROOM
            );

            for (const storeData of Object.values(phoneStoreMap[phone])) {
                if (hasShowRoom && storeData.store.type !== StoreTypeEnum.SHOW_ROOM) continue;

                if (storeData.totalOrders > maxOrders || (storeData.totalOrders === maxOrders && storeData.totalValue > maxTotalValue)) {
                    maxOrders = storeData.totalOrders;
                    maxTotalValue = storeData.totalValue;
                    championStore = storeData;
                }
            }

            if (championStore) {
                championStores[phone] = championStore;
            }
        }

        return championStores;
    }

    public static async updateChampionStoreForCustomers(
        championStoresByPhone: Record<string, { store: Store; totalOrders: number; totalValue: number }>,
        customersByPhone: Map<string, Customer[]>
    ): Promise<void> {
        const records: {
            id: string;
            storeId: string;
        }[] = Object.keys(championStoresByPhone).flatMap((phone: string) => {
            const storeData: {
                store: Store;
                totalOrders: number;
                totalValue: number;
            } = championStoresByPhone[phone];
            const customers: Customer[] = customersByPhone.get(phone) || [];
            return customers.map((customer: Customer) => ({ id: customer.id, storeId: storeData.store.id }));
        });

        const chunks: any = ArrayUtil.splitArrayIntoChunks(records, this.CHUNK_SIZE);
        for (const chunk of chunks) {
            await Customer.bulkCreate(chunk, {
                updateOnDuplicate: ['storeId']
            });
        }
    }
}
